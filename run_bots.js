// @ts-check

const tracery = require('tracery-grammar');
const { TwitterApi, ApiRequestError, ApiResponseError, EApiV1ErrorCode } = require('twitter-api-v2');
const mysql = require('mysql2/promise');

const { convert, createPuppet, destroyPuppet } = require('render-svgs-with-puppeteer');
const fetch = require('node-fetch');
const { AbortController } = require('abort-controller');
const FileType = require('file-type');

const _ = require('lodash');

const { log_line, log_line_error, set_last_error, log_line_single, log_line_single_error } = require("./logging");


/**
 * @param {string} svg_text
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {mysql.Pool} connectionPool
 * @param {import("render-svgs-with-puppeteer").Browser|undefined} svgPuppet
 * @param {string} user_id
 * @param {string} screen_name
 */
async function generate_svg(svg_text, T, connectionPool, svgPuppet, user_id, screen_name) {
	const data = await convert(svg_text, svgPuppet);
	// @ts-ignore
	let media_id = await uploadMedia(data, T, connectionPool, user_id, screen_name);
	return media_id;
}

/**
 * @param {string} url
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {mysql.Pool} connectionPool
 * @param {string} user_id
 * @param {string} screen_name
 */
async function fetch_img(url, T, connectionPool, user_id, screen_name) {

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5 * 1000);

	try {
		let response = await fetch(url, { signal: controller.signal });
		if (response.ok) {
			log_line(screen_name, user_id, "fetched " + url);
			let buffer = await response.buffer();
			log_line(screen_name, user_id, "got buffer " + url);
			let media_id = await uploadMedia(buffer, T, connectionPool, user_id, screen_name);
			return media_id;
		}
		else {
			throw (new MediaRenderError("couldn't fetch " + url + ", returned " + response.status));
		}
	} catch (err) {
		if (err.name === "AbortError") {
			throw (new MediaRenderError("request timed out fetching " + url));
		}
		else {
			throw (err);
		}
	} finally {
		clearTimeout(timeout);
	}

}


/**
 * @param {Buffer} buffer
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {mysql.Pool} connectionPool
 * @param {string} user_id
 * @param {string} screen_name
 */
async function uploadMedia(buffer, T, connectionPool, user_id, screen_name) {
	let file_type = null;
	try {

		log_line(screen_name, user_id, "detecting filetype ");
		file_type = await FileType.fromBuffer(buffer);

		log_line(screen_name, user_id, "detected filetype " + file_type.mime);
	}
	catch (e) {
		log_line_error(screen_name, user_id, "Can't upload media, mime type detection failed", e);
		throw (e);
	}
	if (!file_type) {
		log_line(screen_name, user_id, "Unknown mime type");
		throw (new MediaRenderError("Unknown mime type"));
	}

	try {
		log_line(screen_name, user_id, "uploading media");
		const mediaId = await T.v1.uploadMedia(buffer, { type: file_type.mime });
		log_line(screen_name, user_id, "uploaded media", mediaId);
		return mediaId;
	}
	catch (e) {
		if (e instanceof ApiRequestError) {
			log_line_error(screen_name, user_id, "Can't upload media, API request error", e.requestError);
			throw (e);
		}
		else if (e instanceof ApiResponseError) {
			if (e.errors && "code" in e.errors[0]) {
				await set_last_error(connectionPool, user_id, e.errors[0].code, screen_name);

				if (e.hasErrorCode(EApiV1ErrorCode.YouAreSuspended)) {
					log_line(screen_name, user_id, "Can't upload media, suspended (64)");
				}
				else if (e.hasErrorCode(EApiV1ErrorCode.InvalidOrExpiredToken)) {
					log_line(screen_name, user_id, "Can't upload media, invalid permissions (89)");
				}
				else if (e.hasErrorCode(EApiV1ErrorCode.AccountLocked)) {
					log_line(screen_name, user_id, "Can't upload media, temp locked for spam (326)");
				}
				else if (e.hasErrorCode(EApiV1ErrorCode.RequestLooksLikeSpam)) {
					log_line(screen_name, user_id, "Can't upload media, flagged as bot (226)");
				}
				else {
					log_line_error(screen_name, user_id, "failed to tweet for a more mysterious reason (" + e.code + ")", e);
				}
			}
			else if (e.code !== 200) {
				await set_last_error(connectionPool, user_id, e.code, screen_name);
				if (e.code == 401) {
					log_line_error(screen_name, user_id, "Can't upload media, Not authorized", e.data);
					throw (new MediaRenderError("Can't upload media, Not authorized", false));
				}
				if (e.code == 403) {
					log_line_error(screen_name, user_id, "Can't upload media, Forbidden", e.data);
					throw (new MediaRenderError("Can't upload media, Forbidden", false));
				}
				if (e.code == 400) {
					log_line_error(screen_name, user_id, "Can't upload media, Bad Request", e.data);
					throw (new MediaRenderError("Can't upload media, 400 Bad Request", false));
				}
				else {
					var err = new MediaRenderError("Couldn't upload media, got response status " + e.code);
					log_line_error(screen_name, user_id, err, e.data);
					throw (err);
				}
			}
			else {
				log_line_error(screen_name, user_id, "Can't upload media, API response error", e);
				throw (e);
			}
		}
		else {
			log_line_error(screen_name, user_id, "Can't upload media, other error", e);
			throw (e);
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
 * @param {import("render-svgs-with-puppeteer").Browser|undefined} svgPuppet
 * @param {string} user_id
 * @param {string} screen_name
 */
function render_media_tag(match, T, connectionPool, svgPuppet, user_id, screen_name) {
	var unescapeOpenBracket = /\\{/g;
	var unescapeCloseBracket = /\\}/g;
	match = match.replace(unescapeOpenBracket, "{");
	match = match.replace(unescapeCloseBracket, "}");

	if (match.indexOf("svg ") === 1) {
		return generate_svg(match.substr(5, match.length - 6), T, connectionPool, svgPuppet, user_id, screen_name);
	}
	else if (match.indexOf("img ") === 1 || match.indexOf("vid ") === 1) {
		return fetch_img(match.substr(5, match.length - 6), T, connectionPool, user_id, screen_name);
	}
	else {
		log_line(screen_name, user_id, "error {" + match.substr(1, 4) + "... not recognized");
		throw (new MediaRenderError("error {" + match.substr(1, 4) + "... not recognized"));
	}
}

class MediaRenderError extends Error {
	/**
	 * @param {string} message
	 */
	constructor(message, retry = true) {
		super(message);
		this.name = "MediaRenderError";
		this.retry = retry;
	}
}


/**
 * @param {mysql.Pool} connectionPool
 * @param {import("render-svgs-with-puppeteer").Browser|undefined} svgPuppet
 * @param {string} origin
 * @param {number} tries_remaining
 * @param {any} processedGrammar
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {{ status?: any; }} params
 * @param {{ [x: string]: string; }} result
 * @param {import("twitter-api-v2").TweetV1} in_reply_to
 */
async function doTweet(connectionPool, svgPuppet, origin, tries_remaining, processedGrammar, T, params, result, in_reply_to) {
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
				await set_last_error(connectionPool, result["user_id"], e.errors[0].code, result["screen_name"]);

				if (e.hasErrorCode(EApiV1ErrorCode.TweetTextTooLong)) {
					await recurse_retry(connectionPool, svgPuppet, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				}
				else if (e.hasErrorCode(EApiV1ErrorCode.DuplicatedTweet)) {
					await recurse_retry(connectionPool, svgPuppet, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
				}
				else if (e.hasErrorCode(170)) { //empty tweet
					await recurse_retry(connectionPool, svgPuppet, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
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
				await set_last_error(connectionPool, result["user_id"], e.code, result["screen_name"]);
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
 * @param {import("render-svgs-with-puppeteer").Browser|undefined} svgPuppet
 * @param {string} origin
 * @param {number} tries_remaining
 * @param {*} processedGrammar
 * @param {import("twitter-api-v2").TwitterApiReadWrite} T
 * @param {{ [x: string]: string; }} result
 * @param {import("twitter-api-v2").TweetV1} [in_reply_to]
 */
async function recurse_retry(connectionPool, svgPuppet, origin, tries_remaining, processedGrammar, T, result, in_reply_to) {
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
			var screen_name = in_reply_to.user.screen_name;
			params = { status: "@" + screen_name + " " + tweet_without_image, in_reply_to_status_id: in_reply_to.id_str }
		}

		if (media_tags) {
			let start_time_for_processing_tags = process.hrtime();
			try {
				params.media_ids = await Promise.all(media_tags.map((tag) => render_media_tag(tag, T, connectionPool, svgPuppet, result["user_id"], result["screen_name"])));
			}
			catch (err) {
				if (err instanceof MediaRenderError) {
					if (err.retry) {
						await recurse_retry(connectionPool, svgPuppet, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
						return;
					}
				}
				else {

					log_line_error(result["screen_name"], result["user_id"], "failed rendering and uploading media", err);
				}
			}
			let processing_time = process.hrtime(start_time_for_processing_tags);
			if (processing_time[0] > 5) {
				log_line(result["screen_name"], result["user_id"], `processing media tags took ${processing_time[0]}:${processing_time[1]}`);
			}
			if (processing_time[0] > 60) {
				log_line_error(result["screen_name"], result["user_id"], `processing media tags took too long ${processing_time[0]}:${processing_time[1]}`);
			}
		}

		await doTweet(connectionPool, svgPuppet, origin, tries_remaining, processedGrammar, T, params, result, in_reply_to);
	}
	catch (e) {
		log_line_error(result["screen_name"], result["user_id"], "failed to tweet - unknown error", e);

		await recurse_retry(connectionPool, svgPuppet, origin, tries_remaining - 1, processedGrammar, T, result, in_reply_to);
	}
};



/**
 * @param {mysql.Pool} connectionPool
 * @param {import("render-svgs-with-puppeteer").Browser|undefined} svgPuppet
 * @param {string} user_id
 */
async function tweet_for_account(connectionPool, svgPuppet, user_id) {
	let [tracery_result, fields] = await connectionPool.query('SELECT token, token_secret, screen_name, user_id, tracery from `traceries` where user_id = ?', [user_id]);



	try {
		var processedGrammar = tracery.createGrammar(JSON.parse(tracery_result[0]['tracery']));
		processedGrammar.addModifiers(tracery.baseEngModifiers);
	}
	catch (e) {
		log_line_error(tracery_result[0]['screen_name'], user_id, "failed to process tracery ", e);
		return;
	}

	const T = new TwitterApi({
		appKey: process.env.TWITTER_CONSUMER_KEY,
		appSecret: process.env.TWITTER_CONSUMER_SECRET,
		accessToken: tracery_result[0]['token'],
		accessSecret: tracery_result[0]['token_secret'],
	}).readWrite;



	try {
		await recurse_retry(connectionPool, svgPuppet, "#origin#", 5, processedGrammar, T, tracery_result[0]);
	}
	catch (e) {
		log_line_error(tracery_result[0]['screen_name'], user_id, "failed to tweet ", e);
	}
}


/**
 * 
 * @param {mysql.Pool} connectionPool 
 * @param {import("render-svgs-with-puppeteer").Browser|undefined} svgPuppet
 * @param {string} user_id 
 */
async function reply_for_account(connectionPool, svgPuppet, user_id) {

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
		var mentions = await (await T.v1.mentionTimeline({ since_id: last_reply, count: count, include_entities: false, trim_user: false })).tweets;
	}
	catch (e) {
		if (e instanceof ApiRequestError) {
			log_line_error(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], "Can't fetch replies, API request error", e.requestError);
		}
		else if (e instanceof ApiResponseError) {

			if ('code' in e.errors[0]) {
				await set_last_error(connectionPool, tracery_result[0]["user_id"], e.errors[0].code, tracery_result[0]["screen_name"]);
				log_line_error(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], "Can't fetch replies, API response error. HTTP code:" + e.code + ", Twitter error code:" + e.errors[0].code);
			}
			else {
				log_line_error(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], "Can't fetch replies, API response error. HTTP code:" + e.code);
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
				log_line(tracery_result[0]["screen_name"], tracery_result[0]["user_id"], " replying to ", mention["full_text"]);

				var origin = _.find(reply_rules, (function (origin, rule) { return new RegExp(rule).test(mention["full_text"]); }));
				if (typeof origin != "undefined") {
					if (Math.random() < 0.95) {
						await recurse_retry(connectionPool, svgPuppet, origin, 5, processedGrammar, T, tracery_result[0], mention);
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

	// let svgPuppet = undefined;
	// try {
	// 	svgPuppet = await createPuppet();
	// }
	// catch (e) {
	// 	log_line_single_error("failed to create svgPuppet " + e);
	// }

	let svgPuppet = undefined;

	let tweetCount = 0;

	if (!replies && !isNaN(frequency)) {
		var [results, fields] = await connectionPool.query('SELECT user_id FROM `traceries` WHERE `frequency` = ? AND IFNULL(`blocked_status`, 0) = 0  AND (`last_error_code` IS NULL OR `last_error_code` NOT IN (64, 89, 326))', [frequency]);


		if (typeof results === 'undefined') {
			log_line_single_error("database connection error");
			throw (new Error("Database connection error"));
		}

		// @ts-ignore
		for (const result of results) {
			try {
				await tweet_for_account(connectionPool, svgPuppet, result['user_id']);
				tweetCount += 1;
			}
			catch (e) {
				log_line_error(result['screen_name'], result['user_id'], "failed to tweet : " + e.message);
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
				await reply_for_account(connectionPool, svgPuppet, result['user_id']);
				tweetCount += 1;
			}
			catch (e) {
				log_line_error(result['screen_name'], result['user_id'], "failed to reply : " + e.message);
			}
		}


	}


	// try {
	// 	if (svgPuppet) {
	// 		await destroyPuppet(svgPuppet);
	// 	}
	// }
	// catch (e) {
	// 	log_line_single_error("failed to destroy svgPuppet " + e);
	// }

	await connectionPool.end();
	log_line_single("finished run in " + process.uptime() + " attempted tweet count:" + tweetCount);
}


process.on('exit', (code) => {
	if (code == 0) {
		log_line_single(`Exiting with code: ${code}`);
	}
	else {
		log_line_single_error(`Exiting with code: ${code}`);
	}
});


process.on('uncaughtExceptionMonitor', (err, origin) => {
	log_line_single_error(`Uncaught exception : ${err}, ${origin}`);
});


process.on('unhandledRejection', (reason, promise) => {
	log_line_single_error(`Unhandled Rejection at:${promise}, reason: ${reason}`);
});

run();


