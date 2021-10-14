// @ts-check

const tracery = require('tracery-grammar');
const { TwitterApi, ApiRequestError, ApiResponseError, EApiV1ErrorCode } = require('twitter-api-v2');
const mysql = require('mysql2/promise');

const render_svg = require("render-svgs-with-puppeteer");
const fetch = require('node-fetch');
const FileType = require('file-type');

const _ = require('lodash');

const { log_line, log_line_error, set_last_error, log_line_single, log_line_single_error } = require("./logging");


/**
 * @param {string} svg_text
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {mysql.Pool} connectionPool
 * @param {string} user_id
 */
async function generate_svg(svg_text, T, connectionPool, user_id) {
	const data = await render_svg.convert(svg_text);
	// @ts-ignore
	let media_id = await uploadMedia(data, T, connectionPool, user_id);
	return media_id;
}

/**
 * @param {string} url
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {mysql.Pool} connectionPool
 * @param {string} user_id
 */
async function fetch_img(url, T, connectionPool, user_id) {
	let response = await fetch(url);
	if (response.ok) {
		log_line(null, null, "fetched " + url);
		let buffer = await response.buffer();
		let media_id = await uploadMedia(buffer, T, connectionPool, user_id); //doesn't allow gifs/movies
		return media_id;
	}
	else {
		throw (new Error("couldn't fetch " + url + ", returned " + response.status));
	}
}


/**
 * @param {Buffer} buffer
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {mysql.Pool} connectionPool
 * @param {string} user_id
 */
async function uploadMedia(buffer, T, connectionPool, user_id) {
	try {
		const mimeType = (await FileType.fromBuffer(buffer)).mime;
		const mediaId = await T.v1.uploadMedia(buffer, { type: mimeType });

		log_line(null, user_id, "uploaded media", mediaId);
		return mediaId;
	}
	catch (e) {
		if (e instanceof ApiRequestError) {
			log_line_error(null, user_id, "Can't upload media, API request error", e.requestError);
			throw (e);
		}
		else if (e instanceof ApiResponseError) {
			if ("code" in e.errors[0]) {
				await set_last_error(connectionPool, user_id, e.errors[0].code);
			}

			if (e.code !== 200) {
				await set_last_error(connectionPool, user_id, e.code);
				if (e.code == 401) {
					log_line_error(null, user_id, "Can't upload media, Not authorized", e.data);
					throw (new Error("Can't upload media, Not authorized"));
				}
				if (e.code == 403) {
					log_line_error(null, user_id, "Can't upload media, Forbidden", e.data);
					throw (new Error("Can't upload media, Forbidden"));
				}
				if (e.code == 400) {
					log_line_error(null, user_id, "Can't upload media, Bad Request", e.data);
					throw (new Error("Can't upload media, 400 Bad Request"));
				}
				else {
					var err = new Error("Couldn't upload media, got response status " + e.code);
					log_line_error(null, user_id, err, e.data);
					throw (err);
				}
			}
			else {
				log_line_error(null, user_id, "Can't upload media, API response error", e);
				throw (e);
			}
		}
	}

}

// this is much more complex than i thought it would be
// but this function will find our image tags 
// full credit to BooDooPerson - https://twitter.com/BooDooPerson/status/683450163608817664
// Reverse the string, check with our fucked up regex, return null or reverse matches back
/**
 * @param {string} text
 */
function matchBrackets(text) {

	// simple utility function
	/**
	 * @param {string} s
	 */
	function reverseString(s) {
		return s.split('').reverse().join('');
	}

	// this is an inverstion of the natural order for this RegEx:
	var bracketsRe = /(\}(?!\\)(.+?)\{(?!\\))/g;

	text = reverseString(text);
	var matches = text.match(bracketsRe);
	if (matches === null) {
		return null;
	}
	else {
		return matches.map(reverseString).reverse();
	}
}


//see matchBrackets for why this is like this
/**
 * @param {string} text
 */
function removeBrackets(text) {

	// simple utility function
	var reverseString = function (/** @type {string} */ s) {
		return s.split('').reverse().join('');
	}

	// this is an inverstion of the natural order for this RegEx:
	var bracketsRe = /(\}(?!\\)(.+?)\{(?!\\))/g;

	text = reverseString(text);
	return reverseString(text.replace(bracketsRe, ""));
}



/**
 * @param {string} match
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {mysql.Pool} connectionPool
 * @param {string} user_id
 */
function render_media_tag(match, T, connectionPool, user_id) {
	var unescapeOpenBracket = /\\{/g;
	var unescapeCloseBracket = /\\}/g;
	match = match.replace(unescapeOpenBracket, "{");
	match = match.replace(unescapeCloseBracket, "}");

	if (match.indexOf("svg ") === 1) {
		return generate_svg(match.substr(5, match.length - 6), T, connectionPool, user_id);
	}
	else if (match.indexOf("img ") === 1) {
		return fetch_img(match.substr(5, match.length - 6), T, connectionPool, user_id);
	}
	else {
		throw (new Error("error {" + match.substr(1, 4) + "... not recognized"));
	}
}


/**
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {{ status?: any; }} params
 * @param {{ [x: string]: string; }} result
 * @param {mysql.Pool} connectionPool
 * @param {string} origin
 * @param {number} tries_remaining
 * @param {any} processedGrammar
 * @param {{ [x: string]: any; }} in_reply_to
 */
async function doTweet(T, params, result, connectionPool, origin, tries_remaining, processedGrammar, in_reply_to) {
	try {
		log_line(result["screen_name"], result["user_id"], "tweeting", params);
		const tweet = await T.v1.tweet(params.status, params);
	}
	catch (e) {
		if (e instanceof ApiRequestError) {
			log_line_error(result["screen_name"], result["user_id"], "Can't tweet, API request error", e.requestError);
		}
		else if (e instanceof ApiResponseError) {

			if ('code' in e.errors[0]) {
				await set_last_error(connectionPool, result["user_id"], e.errors[0].code);

				if (e.hasErrorCode(EApiV1ErrorCode.TweetTextTooLong)) {
					await recurse_retry(connectionPool, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				}
				else if (e.hasErrorCode(EApiV1ErrorCode.DuplicatedTweet)) {
					await recurse_retry(connectionPool, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				}
				else if (e.hasErrorCode(170)) { //empty tweet
					await recurse_retry(connectionPool, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				}
				else if (e.hasErrorCode(EApiV1ErrorCode.YouAreSuspended)) {
					log_line(result["screen_name"], result["user_id"], "suspended (64)", params);
				}
				else if (e.hasErrorCode(EApiV1ErrorCode.InvalidOrExpiredToken)) {
					log_line(result["screen_name"], result["user_id"], "invalid permissions (89)", params);
				}
				else if (e.hasErrorCode(EApiV1ErrorCode.AccountLocked)) {
					log_line(result["screen_name"], result["user_id"], "temp locked for spam (326)", params);
				}
				else if (e.hasErrorCode(EApiV1ErrorCode.RequestLooksLikeSpam)) {
					log_line(result["screen_name"], result["user_id"], "flagged as bot (226)", params);
				}
				else {
					log_line_error(result["screen_name"], result["user_id"], "failed to tweet for a more mysterious reason (" + e.code + ")", params);
				}
			}
			else if (e.code !== 200) {
				await set_last_error(connectionPool, result["user_id"], e.code);
				log_line_error(result["screen_name"], result["user_id"], "failed to tweet, http status code " + e.code + ".", params);
			}

		}
		else {
			log_line_error(result["screen_name"], result["user_id"], "!!! Can't tweet, internal error", e);
		}
	}
}


/**
 * @param {mysql.Pool} connectionPool
 * @param {string} origin
 * @param {number} tries_remaining
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {{ [x: string]: string; }} result
 * @param {{ [x: string]: any; }} [in_reply_to]
 */
async function recurse_retry(connectionPool, origin, tries_remaining, processedGrammar, T, result, in_reply_to) {
	if (tries_remaining <= 0) {
		return;
	}

	try {
		var tweet = processedGrammar.flatten(origin);
		var tweet_without_image = removeBrackets(tweet);
		var media_tags = matchBrackets(tweet);

		let params = {};

		if (typeof in_reply_to === 'undefined') {
			params = { status: tweet_without_image };
		}
		else {
			var screen_name = in_reply_to["user"]["screen_name"];
			params = { status: "@" + screen_name + " " + tweet_without_image, in_reply_to_status_id: in_reply_to["id_str"] }
		}

		if (media_tags) {
			let start_time_for_processing_tags = process.hrtime();
			try {
				//can't do this in parallel - Puppeteer gets confused if you try to render two SVGs at once with the same instance
				var medias = [];
				for (const tag of media_tags) {
					var id = await render_media_tag(tag, T, connectionPool, result["user_id"]);
					medias.push(id);
				}
				params.media_ids = medias;
			}
			catch (err) {
				log_line_error(result["screen_name"], result["user_id"], "failed rendering and uploading media", err);
				await recurse_retry(connectionPool, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				return;
			}
			let processing_time = process.hrtime(start_time_for_processing_tags);
			if (processing_time[0] > 5) {
				log_line(result["screen_name"], result["user_id"], `processing media tags took ${processing_time[0]}:${processing_time[1]}`);
			}
			if (processing_time[0] > 60) {
				log_line_error(result["screen_name"], result["user_id"], `processing media tags took too long ${processing_time[0]}:${processing_time[1]}`);
			}
		}

		await doTweet(T, params, result, connectionPool, origin, tries_remaining, processedGrammar, in_reply_to);
	}
	catch (e) {
		log_line_error(result["screen_name"], result["user_id"], "failed to tweet - error", e);
		await recurse_retry(connectionPool, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
	}
};



/**
 * 
 * @param {*} connectionPool 
 * @param {string} user_id 
 */
async function tweet_for_account(connectionPool, user_id) {
	let [tracery_result, fields] = await connectionPool.query('SELECT token, token_secret, screen_name, user_id, tracery from `traceries` where user_id = ?', [user_id]);



	var processedGrammar = tracery.createGrammar(JSON.parse(tracery_result[0]['tracery']));
	processedGrammar.addModifiers(tracery.baseEngModifiers);

	const T = new TwitterApi({
		appKey: process.env.TWITTER_CONSUMER_KEY,
		appSecret: process.env.TWITTER_CONSUMER_SECRET,
		accessToken: tracery_result[0]['token'],
		accessSecret: tracery_result[0]['token_secret'],
	}).readWrite;



	try {
		await recurse_retry(connectionPool, "#origin#", 5, processedGrammar, T, tracery_result[0]);
	}
	catch (e) {
		log_line_error(tracery_result[0]['screen_name'], user_id, "failed to tweet ", e);
	}
}


/**
 * 
 * @param {mysql.Pool} connectionPool 
 * @param {string} user_id 
 */
async function reply_for_account(connectionPool, user_id) {

	if (Math.random() < 0.05) {
		return;
	}

	var [tracery_result, fields] = await connectionPool.query('SELECT token, token_secret, screen_name, tracery, user_id, last_reply, reply_rules from `traceries` where user_id = ?', [user_id]);


	const T = new TwitterApi({
		appKey: process.env.TWITTER_CONSUMER_KEY,
		appSecret: process.env.TWITTER_CONSUMER_SECRET,
		accessToken: tracery_result[0]['token'],
		accessSecret: tracery_result[0]['token_secret'],
	}).readWrite;


	try {
		var processedGrammar = tracery.createGrammar(JSON.parse(tracery_result[0]["tracery"]));
		processedGrammar.addModifiers(tracery.baseEngModifiers);
	}
	catch (e) {
		log_line_error(tracery_result[0]['screen_name'], user_id, "failed to parse tracery for reply ", e);
		return;
	}

	try {
		var reply_rules = JSON.parse(tracery_result[0]["reply_rules"]);
	}
	catch (e) {
		log_line_error(tracery_result[0]['screen_name'], user_id, "failed to parse reply_rules ", e);
		return;
	}


	var last_reply = tracery_result[0]['last_reply'];
	var count = 50;
	if (last_reply == null) {
		log_line(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], " last reply null, setting to 1 ");
		last_reply = "1";
		count = 1;
	}

	try {
		var mentions = await (await T.v1.mentionTimeline({ since_id: last_reply, count: count, include_entities: false, trim_user: true })).tweets;
	}
	catch (e) {
		if (e instanceof ApiRequestError) {
			log_line_error(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], "Can't upload media, API request error", e.requestError);
		}
		else if (e instanceof ApiResponseError) {

			if ('code' in e.errors[0]) {
				log_line_error(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], "Can't upload media, API response error. HTTP code:" + e.code + ", Twitter error code:" + e.errors[0].code);
			}
			else {
				log_line_error(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], "Can't upload media, API response error. HTTP code:" + e.code);
			}
		}

		return;
	}

	if (mentions.length > 0) {
		try {
			let [results, fields] = await connectionPool.query("UPDATE `traceries` SET `last_reply` = ? WHERE `user_id` = ?",
				[mentions[0]["id_str"], tracery_result[0]["user_id"]]);
			log_line(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], " set last_reply to " + mentions[0]["id_str"]);
		}
		catch (e) {
			log_line_error(tracery_result[0]['screen_name'], user_id, "failed to update db for last_reply to " + mentions[0]["id_str"], e);
			return;
		}

		//now we process the replies
		for (const mention of mentions) {
			try {
				log_line(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], " replying to ", mention["text"]);

				var origin = _.find(reply_rules, (function (origin, rule) { return new RegExp(rule).test(mention["text"]); }));
				if (typeof origin != "undefined") {
					if (Math.random() < 0.95) {
						await recurse_retry(connectionPool, origin, 5, processedGrammar, T, tracery_result[0], mention);
					}
				}

			}
			catch (e) {
				log_line_error(tracery_result[0]['screen_name'], user_id, "failed to reply ", e);
			}
		}
	}


}


async function run() {
	log_line_single("starting");

	var arg0 = process.argv[2];
	var replies = (arg0 === "replies");
	var frequency = parseInt(arg0, 10);
	//obv only one of these will be true

	try {
		var connectionPool = await mysql.createPool({
			connectionLimit: 10,
			host: 'localhost',
			user: 'tracery_node',
			password: process.env.TRACERY_NODE_DB_PASSWORD,
			database: 'traceryhosting',
			charset: "utf8mb4"
		});
	}
	catch (e) {
		throw (e);
		return;
	}

	if (!replies && !isNaN(frequency)) {
		var [results, fields] = await connectionPool.query('SELECT user_id FROM `traceries` WHERE `frequency` = ? AND IFNULL(`blocked_status`, 0) = 0  AND (`last_error_code` IS NULL OR `last_error_code` NOT IN (64, 89, 326))', [frequency]);


		if (typeof results === 'undefined') {
			log_line_single_error("database connection error");
			throw (new Error("Database connection error"));
		}

		// @ts-ignore
		for (const result of results) {
			try {
				await tweet_for_account(connectionPool, result['user_id']);
			}
			catch (e) {
				log_line_single_error("failed to tweet for " + result['user_id'] + " : " + e.message);
			}
		}

	}
	else if (replies) {

		try {
			var [results, fields] = await connectionPool.query('SELECT user_id FROM `traceries` WHERE `does_replies` = 1 AND IFNULL(`blocked_status`, 0) = 0 AND (`last_error_code` IS NULL OR `last_error_code` NOT IN (64, 89, 326))');
		}
		catch (e) {
			log_line_single_error("failed to query db for replies");
		}


		for (const result of results) {
			try {
				await reply_for_account(connectionPool, result['user_id']);
			}
			catch (e) {
				log_line_single_error("failed to reply for " + result['user_id'] + " : " + e.message);
			}
		}


	}

	await connectionPool.end();
	log_line_single("finished run");
}

run();


