var git = require('git-rev-sync');
var Raven = require('raven');
Raven.config(process.env.SENTRY_DSN, {
	environment: process.env.ENVIRONMENT_NAME,
	release: git.long()
}).install();

var arg0 = process.argv[2];
var replies = (arg0 === "replies");
var frequency = parseInt(process.argv[2], 10);
//obv only one of these will be true



var tracery = require('tracery-grammar');
var _ = require('underscore');

var Twit = require('twit');

var svg2png = require('svg2png');
var Parallel = require('async-parallel');
var fs = require('fs');
var heapdump = require('heapdump');


_.mixin({
	guid : function(){
	  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
	    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
	    return v.toString(16);
	  });
	}
});



async function generate_svg(svg_text, T)
{
	let data = await svg2png(new Buffer(svg_text));
	let media_id = await uploadMedia(data.toString('base64'), T);
	return media_id;
}

async function fetch_img(url, T)
{
	//todo all this
}



async function uploadMedia(b64data, T)
{
	let {data, resp} = await T.post('media/upload', { media_data: b64data });

	return data.media_id_string;
}

// this is much more complex than i thought it would be
// but this function will find our image tags 
// full credit to BooDooPerson - https://twitter.com/BooDooPerson/status/683450163608817664
// Reverse the string, check with our fucked up regex, return null or reverse matches back
var matchBrackets = function(text) {
  
  // simple utility function
  function reverseString(s) {
    return s.split('').reverse().join('');
  }

  // this is an inverstion of the natural order for this RegEx:
  var bracketsRe = /(\}(?!\\)(.+?)\{(?!\\))/g;

  text = reverseString(text);
  var matches = text.match(bracketsRe);
  if(matches === null) {
    return null;
  }
  else {
    return matches.map(reverseString).reverse();
  }
}


//see matchBrackets for why this is like this
function removeBrackets (text) {
  
  // simple utility function
  var reverseString = function(s) {
    return s.split('').reverse().join('');
  }

  // this is an inverstion of the natural order for this RegEx:
  var bracketsRe = /(\}(?!\\)(.+?)\{(?!\\))/g;

  text = reverseString(text);
  return reverseString(text.replace(bracketsRe, ""));
}


function render_media_tag(match, T)
{

	var unescapeOpenBracket = /\\{/g;
	var unescapeCloseBracket = /\\}/g;
	match = match.replace(unescapeOpenBracket, "{");
	match = match.replace(unescapeCloseBracket, "}");

	if (match.indexOf("svg ") === 1)
	{
		return generate_svg(match.substr(5,match.length - 6), T);
	}
	else if (match.indexOf("img ") === 1)
	{
		return fetch_img(match.substr(5), T);
	}
	else
	{
		throw(new Error("error {" + match.substr(1,4) + "... not recognized"));
	}
}

async function recurse_retry(origin, tries_remaining, processedGrammar, T, result, in_reply_to)
{

	if (tries_remaining <= 0)
	{
		return;
	}

	try
	{
		var tweet = processedGrammar.flatten(origin);
		//console.log(tweet);
		var tweet_without_image = removeBrackets(tweet);
		var media_tags = matchBrackets(tweet);

		let params = {};

		if (typeof in_reply_to === 'undefined')
		{
			params = { status: tweet_without_image};
		}
		else
		{
			var screen_name = in_reply_to["user"]["screen_name"];
			params = {status: "@" + screen_name + " " + tweet_without_image, in_reply_to_status_id:in_reply_to["id_str"]}
		}

		if (media_tags)
		{
			try 
			{
				var medias = await Parallel.map(media_tags, _.partial(render_media_tag, _, T));
				params.media_ids = medias;
			}
			catch (err)
			{
				console.error("error generating SVG for " + result["screen_name"]);
				console.error(err);
				throw(err);
				recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				return;
			}
		}
		console.log("trying to tweet " + tweet + "for " + result["screen_name"]);

		try
		{
			await T.post('statuses/update', params);
		}
		catch (err)
		{
			if (err["code"] == 186)
			{
				//console.log("Tweet (\"" + tweet + "\") over 140 characters - retrying " + (tries_remaining - 1) + " more times.");
				recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
			}
			else if (err['code'] == 187)
			{
				//console.log("Tweet (\"" + tweet + "\") a duplicate - retrying " + (tries_remaining - 1) + " more times.");
				recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
			}

			else if (err['code'] == 89)  
			{
				console.log("Account " + result["screen_name"] + " permissions are invalid");
			}
			else if (err['code'] == 226)  
			{
				console.log("Account " + result["screen_name"] + " has been flagged as a bot");
			}
			else if (err['statusCode'] == 404)
			{
				//unknown error
				
			}
			else
			{
				console.error("twitter returned error " + err['code'] + "for " + result["screen_name"] + " " + JSON.stringify(err, null, 2));  
				console.log("twitter returned error " + err['code'] + "for " + result["screen_name"]);  
				
			}
		}
				
	}
	catch (e)
	{
		if (tries_remaining <= 4)
		{
			console.error("error generating tweet for " + result["screen_name"] + " (retrying)\nerror: " + e.stack);
		}
		recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
	}
	

};
	


async function tweet_account(connectionPool, user_id)
{


	// if (index % 100 == 0)
	// {
	// 	heapdump.writeSnapshot(function(err, filename) {
	// 	  console.log('dump written to', filename);
	// 	});
	// 	console.log(index, "mem usage: ", process.memoryUsage());
	// }

	//setTimeout(function () {
		//console.log("select for account " + user_id);
		try
		{
			let [tracery_result, fields] = await connectionPool.query('SELECT token, token_secret, screen_name, tracery from `traceries` where user_id = ?', [user_id]);

			//console.log(tracery_result);
			try
			{
				//console.log("tweeting for: " + result["screen_name"]);
				var processedGrammar = tracery.createGrammar(JSON.parse(tracery_result[0]['tracery']));
				processedGrammar.addModifiers(tracery.baseEngModifiers); 
				
				var T = new Twit(
				{
				    consumer_key:         process.env.TWITTER_CONSUMER_KEY
				  , consumer_secret:      process.env.TWITTER_CONSUMER_SECRET
				  , access_token:         tracery_result[0]['token']
				  , access_token_secret:  tracery_result[0]['token_secret']
				}
				);

		  		await recurse_retry("#origin#", 5, processedGrammar, T, tracery_result[0]);

				//console.log("recurse_retryd for account " + user_id);
			}
			catch (e)
			{
				console.error("error generating tweet for " + tracery_result[0]["screen_name"] + "\ntracery: " + tracery_result[0]["tracery"] + "\n\n~~~\nerror: " + e.stack);
			}
				

		}
		catch(e)
		{
				console.error("db connection error: " + e);

		}

			
		
    //}, 1000 * 2 * index); //one bot per 2 secs, to stop clustering 

				
}

async function reply_for_account(connectionPool, user_id)
{
	
	if (Math.random() < 0.05)
	{
		return;
	}

	try
	{
		var [tracery_result, fields] = await connectionPool.query('SELECT token, token_secret, screen_name, tracery, user_id, reply_rules from `traceries` where user_id = ?', [user_id]);
	}
	catch (e)
	{
		console.error("db connection error: " + e);
		throw(e);
	}

	var T = new Twit(
		{
			consumer_key:         process.env.TWITTER_CONSUMER_KEY
		  , consumer_secret:      process.env.TWITTER_CONSUMER_SECRET
		  , access_token:         tracery_result[0]['token']
		  , access_token_secret:  tracery_result[0]['token_secret']
		}
	);

	try
	{
		var processedGrammar = tracery.createGrammar(JSON.parse(tracery_result[0]["tracery"]));
		processedGrammar.addModifiers(tracery.baseEngModifiers); 
	}
	catch (e)
	{
		console.error("error generating tweet for " + tracery_result[0]["screen_name"] + "\ntracery: " + tracery_result[0]["tracery"] + "\n\n~~~\nerror: " + e.stack);
		throw(e);
	}

	try
	{
		var reply_rules = JSON.parse(tracery_result[0]["reply_rules"]);
	}
	catch(e)
	{
		console.log("couldn't parse reply_rules for " + tracery_result[0]["screen_name"]);
		throw(e);
	}


	var last_reply = tracery_result[0]['last_reply'];
	var count = 50;
	if (last_reply == null)
	{
		console.log(tracery_result[0]["screen_name"] + " last_reply null, setting to 0");
		last_reply = "1";
		count = 1;
	}

	try
	{
		var {resp, data} = await T.get('statuses/mentions_timeline', {count:count, since_id:last_reply, include_entities: false});

	}
	catch (e)
	{
		console.log("error fetching mentions for " + tracery_result[0]["screen_name"] + " err:" + e);
		throw(e);
	}

	if (resp.statusCode != 200)
	{
		console.log("can't fetch mentions for " + tracery_result[0]["screen_name"] + " status code:" + resp.statusCode + " message:" + resp.statusMessage)
	}
	
	//todo save last_reply to id in 0
	
	if (data.length > 0)
	{
		console.log("update for account reply");

		try
		{
			let [results, fields] = await connectionPool.query("UPDATE `traceries` SET `last_reply` = ? WHERE `user_id` = ?", 
															   [data[0]["id_str"], tracery_result[0]["user_id"]]);
		
			console.log("have set last_reply to " + data[0]["id_str"] + " for " + tracery_result[0]["screen_name"]);
		}
		catch (e)
		{
			console.log("couldn't set last_reply to " + data[0]["id_str"] + " for " + tracery_result[0]["screen_name"] + " " + e);
			throw(e);
		}

		//now we process the replies
		for (const mention of data) {
			try
			{
				console.log("tweet to reply to:" + mention["text"]);
	
				var origin = _.find(reply_rules, function(origin,rule) {return new RegExp(rule).test(mention["text"]);});
				if (typeof origin != "undefined")
				{
					await recurse_retry(origin, 5, processedGrammar, T, tracery_result[0], mention);
				}

			}
			catch (e)
			{
				console.log("couldn't reply to " + data[0]["id_str"] + " for " + tracery_result[0]["screen_name"] + " " + e);
				throw(e);

			}
		}
	}

	
}



// connectionPool.connect(function(err) {
//   if (err) {
//     console.error('error connecting: ' + err.stack);
//     return;
//   }
 


async function run()
{
	const mysql      = require('mysql2/promise');
	try
	{
		var connectionPool = await mysql.createPool({
			connectionLimit : 10,
			host     : 'localhost',
			user     : 'tracery_node',
			password : process.env.TRACERY_NODE_DB_PASSWORD,
			database : 'traceryhosting',
			charset : "utf8mb4"
		});
	}
	catch(e)
	{
		console.error("error connecting to db: " + e.stack);
		throw(e);
	}	

	if (!replies && !isNaN(frequency))
	{

		//console.log("select all");
		
		try
		{
			var [results, fields] = await connectionPool.query('SELECT user_id FROM `traceries` WHERE `frequency` = ? AND IFNULL(`blocked_status`, 0) = 0', [frequency]);
		}
		catch(e)
		{
			console.error("main db connection error: " + e.stack);
		}	

		for (const result of results) {
			try
			{
				await tweet_account(connectionPool, result['user_id']);
			}
			catch (e)
			{
				console.error("hit error for ", result);
			}
		}

		
		




	}
	else if (replies)
	{

		try 
		{
			var [results, fields] = await connectionPool.query('SELECT user_id FROM `traceries` WHERE `does_replies` = 1 AND IFNULL(`blocked_status`, 0) = 0');
		}
		catch(e)
		{
			console.error("doing replies, db connection error: " + e.stack);
			throw (e);
		}


		for (const result of results) {
			try
			{
				await reply_for_account(connectionPool, result['user_id']);
			}
			catch (e)
			{
				console.error("doing replies, hit error for ", result, e);
			}
		}

		
	}

	try 
	{
		await connectionPool.end();
	}
	catch(e)
	{
		console.error("db closing connection error: " + e.stack);
		throw (e);
	}
}

run();


