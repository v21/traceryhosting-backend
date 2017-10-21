

var arg0 = process.argv[2];
var replies = (arg0 === "replies");
var frequency = parseInt(process.argv[2], 10);
//obv only one of these will be true



var tracery = require('tracery-grammar');
var _ = require('underscore');

var Twit = require('twit');

var svg2png = require('svg2png');
var async = require('async');
var fs = require('fs');

_.mixin({
	guid : function(){
	  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
	    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
	    return v.toString(16);
	  });
	}
});

var mysql      = require('mysql');
var connection = mysql.createConnection({

    host     : 'localhost',
    user     : 'tracery_node',
    password : process.env.TRACERY_NODE_DB_PASSWORD,
    database : 'traceryhosting',
    charset : "utf8mb4"
});

var generate_svg = function(svg_text, T, cb)
{
	
		svg2png(new Buffer(svg_text))
		.then(data => uploadMedia(data.toString('base64'), T, cb))
		.catch(e => cb(e));

}

var fetch_img = function(url, T, cb)
{
	//todo all this
}

var uploadMedia = function(b64data, T, cb)
{
	T.post('media/upload', { media_data: b64data }, function (err, data, response) {
		if (err)
		{
			cb(err);
		}
		else
		{
			cb(null, data.media_id_string);
		}
	});
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


var recurse_retry = function(origin, tries_remaining, processedGrammar, T, result, in_reply_to)
{

	if (tries_remaining <= 0)
	{
		return;
	}
	else
	{
		try
		{
			var tweet = processedGrammar.flatten(origin);
			//console.log(tweet);
			var tweet_without_image = removeBrackets(tweet);
			var media_tags = matchBrackets(tweet);
			if (media_tags)
			{
				
				async.parallel(media_tags.map(function(match){
					
					
					var unescapeOpenBracket = /\\{/g;
					var unescapeCloseBracket = /\\}/g;
					match = match.replace(unescapeOpenBracket, "{");
					match = match.replace(unescapeCloseBracket, "}");

					if (match.indexOf("svg ") === 1)
					{
						return _.partial(generate_svg, match.substr(5,match.length - 6), T);
					}
					else if (match.indexOf("img ") === 1)
					{
						return _.partial(fetch_img, match.substr(5), T);
					}
					else
					{
						return function(cb){
							cb("error {" + match.substr(1,4) + "... not recognized");
						}
					}
				}),
				function(err, results)
				{
					if (err)
					{
						console.error("error generating SVG for " + result["screen_name"]);
						console.error(err);
						recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
						return;
					}
					var params = {};
					if (typeof in_reply_to === 'undefined')
					{
		  				params = { status: tweet_without_image, media_ids: results };
					}
					else
					{
						var screen_name = in_reply_to["user"]["screen_name"];
						params = {status: "@" + screen_name + " " + tweet_without_image, media_ids: results, in_reply_to_status_id:in_reply_to["id_str"]}
					}
					T.post('statuses/update', params, function(err, data, response) {
						if (err)
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

					});
				});

			}
			else
			{

	  			var params = {};
				if (typeof in_reply_to === 'undefined')
				{
	  				params = { status: tweet};
				}
				else
				{
					var screen_name = in_reply_to["user"]["screen_name"];
					params = {status: "@" + screen_name + " " + tweet, in_reply_to_status_id:in_reply_to["id_str"]}
				}
				//console.log("trying to tweet " + tweet + "for " + result["screen_name"]);
				T.post('statuses/update', params, function(err, data, response) {
					if (err)
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

				});
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
		
	}
	
};


connection.connect(function(err) {
  if (err) {
    console.error('error connecting: ' + err.stack);
    return;
  }
 



  	if (!replies && !isNaN(frequency))
  	{

		connection.query('SELECT * FROM `traceries` WHERE `frequency` = ? AND IFNULL(`blocked_status`, 0) = 0', [frequency], function (error, results, fields) {
		// error will be an Error if one occurred during the query 
		// results will contain the results of the query 
		// fields will contain information about the returned results fields (if any) 
		if (error)
		{
			console.error("db connection error: " + error.stack);
		}
			_.each(results, function(result, index, list)
			{ 

				if (result["blocked_status"] != 0 && result["blocked_status"] != null) //this should be redundant
				{
					console.error(result["screen_name"] + " blocked but still coming through");
					return;
				}

				//setTimeout(function () {
					try
					{
						//console.log("tweeting for: " + result["screen_name"]);
						var processedGrammar = tracery.createGrammar(JSON.parse(result["tracery"]));
						processedGrammar.addModifiers(tracery.baseEngModifiers); 
						
						var T = new Twit(
						{
						    consumer_key:         process.env.TWITTER_CONSUMER_KEY
						  , consumer_secret:      process.env.TWITTER_CONSUMER_SECRET
						  , access_token:         result['token']
						  , access_token_secret:  result['token_secret']
						}
						);

				  		recurse_retry("#origin#", 5, processedGrammar, T, result);
					}
					catch (e)
					{
						console.error("error generating tweet for " + result["screen_name"] + "\ntracery: " + result["tracery"] + "\n\n~~~\nerror: " + e.stack);
					}
			    //}, 1000 * 2 * index); //one bot per 2 secs, to stop clustering 

				
				
			});


		});


		connection.end(function(err) {
		  // The connection is terminated now 
		});
	}
	else if (replies)
	{
		connection.query('SELECT * FROM `traceries` WHERE `does_replies` = 1 AND IFNULL(`blocked_status`, 0) = 0', [], function (error, results, fields) {
		// error will be an Error if one occurred during the query 
		// results will contain the results of the query 
		// fields will contain information about the returned results fields (if any) 
		if (error)
		{
			console.error("doing replies, db connection error: " + error.stack);
		}
			_.each(results, function(result, index, list)
			{ 
				if (result["blocked_status"] != 0 && result["blocked_status"] != null)//this should be redundant
				{
					console.error(result["screen_name"] + " blocked but still coming through");
					return;
				}

				if (Math.random() < 0.05)
				{
					return;
				}

				try
				{
					var T = new Twit(
					{
					    consumer_key:         process.env.TWITTER_CONSUMER_KEY
					  , consumer_secret:      process.env.TWITTER_CONSUMER_SECRET
					  , access_token:         result['token']
					  , access_token_secret:  result['token_secret']
					}
					);

					var processedGrammar = tracery.createGrammar(JSON.parse(result["tracery"]));

					processedGrammar.addModifiers(tracery.baseEngModifiers); 

					try
					{
						try
						{
							var reply_rules = JSON.parse(result["reply_rules"]);
						}
						catch(e)
						{
							console.log("couldn't parse reply_rules for " + result["screen_name"]);
						}
						var last_reply = result['last_reply'];
						var count = 50;
						if (last_reply == null)
						{
							console.log(result["screen_name"] + " last_reply null, setting to 0");
							last_reply = "1";
							count = 1;
						}
						T.get('statuses/mentions_timeline', {count:count, since_id:last_reply, include_entities: false}, function(err, data, response) {
							if (err)
							{
								console.log("error fetching mentions for " + result["screen_name"] + " err:" + err);
							}
							else
							{

								//todo save last_reply to id in 0
								if (data.length > 0)
								{

									var update_conn = mysql.createConnection({

									    host     : 'localhost',
									    user     : 'tracery_node',
									    password : process.env.TRACERY_NODE_DB_PASSWORD,
									    database : 'traceryhosting',
									    charset : "utf8mb4"
									});
									update_conn.query("UPDATE `traceries` SET `last_reply` = ? WHERE `user_id` = ?", [data[0]["id_str"], result["user_id"]],
										function(err, results, fields)
										{
											if (err)
											{
												console.log("couldn't set last_reply to " + data[0]["id_str"] + " for " + result["screen_name"] + " " + err);
											}
											else
											{
												console.log("have set last_reply to " + data[0]["id_str"] + " for " + result["screen_name"]);

												_.each(data, function(mention, index, list)
												{
													console.log("tweet to reply to:" + mention["text"]);

													var origin = _.find(reply_rules, function(origin,rule) {return new RegExp(rule).test(mention["text"]);});
													if (typeof origin != "undefined")
													{
														recurse_retry(origin, 5, processedGrammar, T, result, mention);
													}
												});
											}
											update_conn.end(function(err) {
											  // The connection is terminated now 
											});

											
										})
								}
								else
								{
									
								}

								
							}


						});

					}
					catch(e)
					{
						console.log("reply_rules error for " + result["screen_name"] + e);
					}

					
					//console.log("tracery: " + result["tracery"] + "\n\n");
					
			  		//recurse_retry(get_reply_origin(result[reply_rules]), 5, processedGrammar, T, result);
				}
				catch (e)
				{
					console.error("error generating tweet for " + result["screen_name"] + "\ntracery: " + result["tracery"] + "\n\n~~~\nerror: " + e.stack);
				}
		    
				
				
			});


		});
	}
	connection.end(function(err) {
	  // The connection is terminated now 
	});

});

