

var frequency = parseInt(process.argv[2], 10);

var tracery = require('tracery-grammar');
var _ = require('underscore');

var Twit = require('twit');


var mysql      = require('mysql');
var connection = mysql.createConnection({

    host     : 'localhost',
    user     : 'tracery_node',
    password : process.env.TRACERY_NODE_DB_PASSWORD,
    database : 'traceryhosting'
});
 
connection.connect(function(err) {
  if (err) {
    console.error('error connecting: ' + err.stack);
    return;
  }
 
  console.log('connected as id ' + connection.threadId);

	connection.query('SELECT * FROM `traceries` WHERE `frequency` = ?', [frequency], function (error, results, fields) {
	// error will be an Error if one occurred during the query 
	// results will contain the results of the query 
	// fields will contain information about the returned results fields (if any) 
		_.each(results, function(result, index, list)
		{
			try
			{
				var processedGrammar = tracery.createGrammar(JSON.parse(result["tracery"]));
				var tweet = processedGrammar.flatten("#origin#");

				var T = new Twit(
				{
				    consumer_key:         process.env.TWITTER_CONSUMER_KEY
				  , consumer_secret:      process.env.TWITTER_CONSUMER_SECRET
				  , access_token:         result['token']
				  , access_token_secret:  result['token_secret']
				}
				);


				T.post('statuses/update', { status: tweet }, function(err, data, response) {
				  //console.log(data)
				})
			}
			catch (e)
			{
				console.error(e);
			}
			

		});


	});

	connection.end(function(err) {
	  // The connection is terminated now 
	});

});
