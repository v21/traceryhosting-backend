
async function run()
{
	const mysql      = require('mysql2/promise');
	var connectionPool = await mysql.createPool({
	    connectionLimit : 10,
	    host     : 'localhost',
	    user     : 'tracery_node',
	    password : process.env.TRACERY_NODE_DB_PASSWORD,
	    database : 'traceryhosting',
	    charset : "utf8mb4"
	});

	

	console.log("select all");
	
	try
	{
		let [results, fields] = await connectionPool.execute('SELECT user_id FROM `traceries` WHERE `frequency` = ? AND IFNULL(`blocked_status`, 0) = 0 LIMIT 1', [10]);
		console.log(results[0]);
	}
	catch(e)
	{
		console.error(e);
	}
	
}

run();


var T = new Twit(
				{
				    consumer_key:         process.env.TWITTER_CONSUMER_KEY
				  , consumer_secret:      process.env.TWITTER_CONSUMER_SECRET
				  , access_token:         "aEF"
				  , access_token_secret:  "afsdaf"
				}
				);