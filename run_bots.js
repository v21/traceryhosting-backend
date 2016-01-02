

var frequency = parseInt(process.argv[2], 10);

var tracery = require('tracery-grammar');
var _ = require('underscore');

var Twit = require('twit');


var mysql      = require('mysql');
var connection = mysql.createConnection({

    host     : 'localhost',
    user     : 'tracery_node',
    password : process.env.TRACERY_NODE_DB_PASSWORD,
    database : 'traceryhosting',
    charset : "utf8mb4"
});
 

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
		
			console.log("trying to tweet " + tweet + "for " + result["screen_name"]);
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
			

		});


	});

	connection.end(function(err) {
	  // The connection is terminated now 
	});

});
