

var frequency = parseInt(process.argv[2], 10);

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


 var recurse_retry = function(tries_remaining, processedGrammar, T, result)
{
	if (tries_remaining <= 0)
	{
		return;
	}
	else
	{
		try
		{
			var tweet = processedGrammar.flatten("#origin#");
			//console.log(tweet);
			var tweet_without_image = removeBrackets(tweet);
			var media_tags = matchBrackets(tweet);
			if (media_tags)
			{
				async.parallel(media_tags.map(function(match){
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
						recurse_retry(tries_remaining - 1, processedGrammar, T, result);
						return;
					}

		  			var params = { status: tweet_without_image, media_ids: results };
					T.post('statuses/update', params, function(err, data, response) {
						if (err)
						{
						  	if (err["code"] == 186)
						  	{
						  		//console.log("Tweet (\"" + tweet + "\") over 140 characters - retrying " + (tries_remaining - 1) + " more times.");
						  		recurse_retry(tries_remaining - 1, processedGrammar, T, result);
						  	}
						  	else if (err['code'] == 187)
					  		{
					  			//console.log("Tweet (\"" + tweet + "\") a duplicate - retrying " + (tries_remaining - 1) + " more times.");
					  			recurse_retry(tries_remaining - 1, processedGrammar, T, result);
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
				//console.log("trying to tweet " + tweet + "for " + result["screen_name"]);
				T.post('statuses/update', { status: tweet }, function(err, data, response) {
					if (err)
					{
					  	if (err["code"] == 186)
					  	{
					  		//console.log("Tweet (\"" + tweet + "\") over 140 characters - retrying " + (tries_remaining - 1) + " more times.");
					  		recurse_retry(tries_remaining - 1, processedGrammar, T, result);
					  	}
					  	else if (err['code'] == 187)
				  		{
				  			//console.log("Tweet (\"" + tweet + "\") a duplicate - retrying " + (tries_remaining - 1) + " more times.");
				  			recurse_retry(tries_remaining - 1, processedGrammar, T, result);
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
			recurse_retry(tries_remaining - 1, processedGrammar, T, result);
		}
		
	}
	
};


connection.connect(function(err) {
  if (err) {
    console.error('error connecting: ' + err.stack);
    return;
  }
 
  //console.log('connected as id ' + connection.threadId);

	connection.query('SELECT * FROM `traceries` WHERE `frequency` = ?', [frequency], function (error, results, fields) {
	// error will be an Error if one occurred during the query 
	// results will contain the results of the query 
	// fields will contain information about the returned results fields (if any) 
	if (error)
	{
		console.error("db connection error: " + error.stack);
	}
		_.each(results, function(result, index, list)
		{ 
			if (result["blocked_status"] != 0 && result["blocked_status"] != null)
			{
				console.log(result["screen_name"] + " blocked");
				return;
			}

			setTimeout(function () {
				try
				{
					//console.log("tracery: " + result["tracery"] + "\n\n");
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

			  		recurse_retry(5, processedGrammar, T, result);
				}
				catch (e)
				{
					console.error("error generating tweet for " + result["screen_name"] + "\ntracery: " + result["tracery"] + "\n\n~~~\nerror: " + e.stack);
				}
		    }, 1000 * 2 * index); //one bot per 2 secs, to stop clustering 

			
			
		});


	});

	connection.end(function(err) {
	  // The connection is terminated now 
	});

});
