var git = require('git-rev-sync');
var Raven = require('raven');
Raven.config(process.env.SENTRY_DSN, {
	environment: process.env.ENVIRONMENT_NAME,
	release: git.long()
}).install();

var arg0 = process.argv[2];
var replies = (arg0 === "replies");
var frequency = parseInt(arg0, 10);
//obv only one of these will be true



var tracery = require('tracery-grammar');
var _ = require('underscore');

var Twit = require('twit');

var svg2png = require('svg2png');
var fs = require('fs');
var heapdump = require('heapdump');
var util = require("util");


function log_line_single(message)
{
	console.log(
		new Date().toISOString(),
		"arg:" + arg0,
		message
	);
}

function log_line(screen_name, userid, message, params)
{
	if (params)
	{
		if (params.status)
		{
			params.status = params.status.replace("\n", "\\n");
		}
		params = util.inspect(params, {breakLength: Infinity, maxArrayLength:5});
	}
	console.log(
		new Date().toISOString(),
		"arg:" + arg0,
		screen_name,
		"(" + userid + ")",
		message,
		params
	);
}

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
	var {data, resp} = await T.post('media/upload', { media_data: b64data });


	if (data.errors)
	{
		if (data.errors[0].code == 64) // suspended
		{
			throw (new Error ("Can't upload media, suspended"));
		}
	}
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
			Raven.captureException(err,
				{
					extra:
					{
						response : resp,
						data : data
					}
				});
			throw (err);
		}
	}

	log_line(null, null, "uploaded media", data);
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
				console.error(err);
				recurse_retry(origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				return;
			}
		}
		log_line(result["screen_name"], result["user_id"], "tweeting", params);

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
					log_line(result["screen_name"], result["user_id"], "suspended (64)", params);
				}
				else if (err['code'] == 89)  
				{
					log_line(result["screen_name"], result["user_id"], "invalid permissions (89)", params);
				}
				else if (err['code'] == 326)  
				{
					log_line(result["screen_name"], result["user_id"], "temp locked for spam (326)", params);
				}
				else if (err['code'] == 226)  
				{
					log_line(result["screen_name"], result["user_id"], "flagged as bot (226)", params);
				}
				else if (err['statusCode'] == 404)
				{
					log_line(result["screen_name"], result["user_id"], "mystery status (404)", params);
				}
				else
				{
					log_line(result["screen_name"], result["user_id"], "failed for a more mysterious reason (" + err["code"] + ")", params);
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
				}
			}
		}
		catch (err)
		{
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
		Raven.captureException(e, 
		{
			user: 
			{
				username: result['screen_name'],
				id : result['user_id']
			},
			extra:
			{
				tries_remaining: tries_remaining,
				mention: in_reply_to,
				tracery: result['tracery']
			}
		});
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

	var [tracery_result, fields] = await connectionPool.query('SELECT token, token_secret, screen_name, tracery, user_id, last_reply, reply_rules from `traceries` where user_id = ?', [user_id]);
	

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
				reply_rules : tracery_result[0]["reply_rules"],
				last_reply : tracery_result[0]["last_reply"]
			}
		});
	}

	try
	{
		var reply_rules = JSON.parse(tracery_result[0]["reply_rules"]);
	}
	catch(e)
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
				tracery: tracery_result[0]['tracery'],
				reply_rules : tracery_result[0]["reply_rules"],
				last_reply : tracery_result[0]["last_reply"]
			}
		});
	}


	var last_reply = tracery_result[0]['last_reply'];
	var count = 50;
	if (last_reply == null)
	{
		log_line(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], " last reply null, setting to 1 ");
		last_reply = "1";
		count = 1;
	}

	var {resp, data} = await T.get('statuses/mentions_timeline', {count:count, since_id:last_reply, include_entities: false});

	if (resp.statusCode != 200)
	{
		log_line(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], " can't fetch mentions, statusCode: " + resp.statusCode + " message:" + resp.statusMessage + " data:", data);
	}
		
	if (data.length > 0)
	{
		try
		{
			let [results, fields] = await connectionPool.query("UPDATE `traceries` SET `last_reply` = ? WHERE `user_id` = ?", 
															   [data[0]["id_str"], tracery_result[0]["user_id"]]);
		

			log_line(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], " set last_reply to " + data[0]["id_str"]);
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
					tracery: tracery_result[0]['tracery'],
					reply_rules : tracery_result[0]["reply_rules"],
					last_reply : tracery_result[0]["last_reply"]
				}
			});
			return;
		}

		//now we process the replies
		for (const mention of data) {
			try
			{
				log_line(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], " replying to ", mention["text"]);
	
				var origin = _.find(reply_rules, function(origin,rule) {return new RegExp(rule).test(mention["text"]);});
				if (typeof origin != "undefined")
				{
					await recurse_retry(origin, 5, processedGrammar, T, tracery_result[0], mention);
				}

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
	log_line_single("starting");
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
		throw(e);
		return;
	}	

	if (!replies && !isNaN(frequency))
	{
		var [results, fields] = await connectionPool.query('SELECT user_id FROM `traceries` WHERE `frequency` = ? AND IFNULL(`blocked_status`, 0) = 0', [frequency]);
		

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
				Raven.captureException(e, { user: { id : result['user_id'] } });
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
			Raven.captureException(e, { user: { id : result['user_id'] } });
		}


		for (const result of results) {
			try
			{
				await reply_for_account(connectionPool, result['user_id']);
			}
			catch (e)
			{
				Raven.captureException(e, { user: { id : result['user_id'] } });
			}
		}

		
	}

	await connectionPool.end();
	log_line_single("closed");
}

run();


