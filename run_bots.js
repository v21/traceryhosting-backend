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
var fs = require('fs');
var heapdump = require('heapdump');


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
	try
	{
		var {data, resp} = await T.post('media/upload', { media_data: b64data });

		if (resp.statusCode != 200)
		{
			if (resp.statusCode == 401)
			{
				throw (new Error ("Can't upload media, Not authorized"));
			}
			if (resp.statusCode == 403)
			{
				throw (new Error ("Can't upload media, Forbidden"));
			}
			else
			{
				var err = new Error("Couldn't upload media, got response status " + resp.statusCode + " (" + resp.statusMessage + ")");
				
				throw (err);
			}
		}
		return data.media_id_string;
	}
	catch (e)
	{
		//todo filter out auth problems, other common problems
		Raven.captureException(err,
		{
			extra:
			{
				response : resp,
				data : data
			}
		});
		throw (e);
	}
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
				var media_promises = media_tags.map(tag => render_media_tag(tag, T));
				var medias = await Promise.all(media_promises);
				params.media_ids = medias;
			}
			catch (err)
			{
				console.error("error generating SVG for " + result["screen_name"]);
				console.error(err);
				recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				return;
			}
		}
		console.log("trying to tweet " + tweet + "for " + result["screen_name"]);

		try
		{
			var {data, resp} = await T.post('statuses/update', params);

			if (resp.statusCode != 200)
			{
				if (data.errors){var err = data.errors[0];}
				else { throw new Error("Twitter gave a non-200 response, but no error")}

				if (err["code"] == 186) // too long
				{
					recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				}
				else if (err['code'] == 187) //duplicate tweet
				{
					recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				}
				else if (err['code'] == 170) //empty tweet
				{
					recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				}
					
				else if (err['code'] == 64)  
				{
					console.log("Account " + result["screen_name"] + " is suspended");
				}
				else if (err['code'] == 89)  
				{
					console.log("Account " + result["screen_name"] + " permissions are invalid");
				}
				else if (err['code'] == 326)  
				{
					console.log("Account " + result["screen_name"] + " is temporarily locked for spam");
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
					console.log("Account " + result["screen_name"] + " has unknown error " + err['code']);
					Raven.captureMessage("Failed to tweet, Twiter gave err " + err['code'], 
					{
						user: 
						{
							username: result['screen_name'],
							id : result['user_id']
						},
						extra:
						{
							params : params,
							tries_remaining: tries_remaining,
							mention: in_reply_to,
							tracery: result['tracery'],
							response : resp,
							data : data
						}
					});
					
					console.error("twitter returned error " + err['code'] + "for " + result["screen_name"] + " " + JSON.stringify(err, null, 2));
				}
			}
		}
		catch (err)
		{
			console.log("Account " + result["screen_name"] + " has unknown error ");
			Raven.captureException(err, 
			{
				user: 
				{
					username: result['screen_name'],
					id : result['user_id']
				},
				extra:
				{
					params : params,
					tries_remaining: tries_remaining,
					mention: in_reply_to,
					tracery: result['tracery'],
					response : resp,
					data : data
				}
			});
			throw (err);
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
	


async function tweet_for_account(connectionPool, user_id)
{
	let [tracery_result, fields] = await connectionPool.query('SELECT token, token_secret, screen_name, user_id, tracery from `traceries` where user_id = ?', [user_id]);



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

	try
	{
		await recurse_retry("#origin#", 5, processedGrammar, T, tracery_result[0]);
	}
	catch (e)
	{
		Raven.captureException(e, 
		{
			user: 
			{
				username: tracery_result[0]['screen_name'],
				id : user_id
			},
			extra:
			{
				tracery: tracery_result[0]['tracery']
			}
		});
	}
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
				console.log("couldn't reply to " + mention["id_str"] + " for " + tracery_result[0]["screen_name"] + " " + e);
				throw(e);

				Raven.captureException(e, 
				{
					user: 
					{
						username: tracery_result[0]['screen_name'],
						id : user_id
					},
					extra:
					{
						tracery: tracery_result[0]['tracery'],
						mention: mention
					}
				});
			
			}
		}
	}

	
}


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
		return;
	}	

	if (!replies && !isNaN(frequency))
	{
		try
		{
			var [results, fields] = await connectionPool.query('SELECT user_id FROM `traceries` WHERE `frequency` = ? AND IFNULL(`blocked_status`, 0) = 0', [frequency]);
		}
		catch(e)
		{
			console.error("main db error: " + e.stack);
		}

		if (typeof results === 'undefined')
		{
			throw(new Error("Database connection error"));
		}

		for (const result of results) {
			try
			{
				await tweet_for_account(connectionPool, result['user_id']);
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
			console.error("doing replies, db error: " + e.stack);
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


