const util = require("util");
const { pid } = require('process');

/**
 * @param {string} message
 */
function log_line_single(message) {
	console.log(
		new Date().toISOString(),
		pid,
		"arg:" + process.argv[2],
		"PROCESS_INFO",
		message
	);
}
exports.log_line_single = log_line_single;
/**
 * @param {any} screen_name
 * @param {string} userid
 * @param {string} [message]
 * @param {object} [params]
 */
function log_line(screen_name, userid, message, params) {
	if (params) {
		var paramString = util.inspect(params, { breakLength: Infinity, maxArrayLength: 5 });

		paramString = paramString.replace("\n", "\\n");
	}
	console.log(
		new Date().toISOString(),
		pid,
		"arg:" + process.argv[2],
		"INFO",
		screen_name,
		"(" + userid + ")",
		message,
		paramString ? paramString : ""
	);
}
exports.log_line = log_line;
/**
 * @param {string} message
 */
function log_line_single_error(message) {
	console.error(
		new Date().toISOString(),
		pid,
		"arg:" + process.argv[2],
		"ERROR",
		message
	);
}
exports.log_line_single_error = log_line_single_error;
/**
 * @param {any} screen_name
 * @param {string} userid
 * @param {string | Error} message
 * @param {{}} [params]
 */
function log_line_error(screen_name, userid, message, params) {
	if (params) {
		var paramString = util.inspect(params, { breakLength: Infinity, maxArrayLength: 5 });

		paramString = paramString.replace("\n", "\\n");
	}
	console.error(
		new Date().toISOString(),
		pid,
		"arg:" + process.argv[2],
		"ERROR",
		screen_name,
		"(" + userid + ")",
		message,
		paramString ? paramString : ""
	);
}
exports.log_line_error = log_line_error;
/**
 * @param {mysql.Pool} connectionPool
 * @param {string} user_id
 * @param {string} user_id
 * @param {string | number} error_code
 */

async function set_last_error(connectionPool, user_id, error_code, screen_name) {
	try {
		let [results, fields] = await connectionPool.query("UPDATE `traceries` SET `last_error_code` = ? WHERE `user_id` = ?",
			[error_code, user_id]);

		log_line(screen_name, user_id, " set last_error_code to " + error_code);
	}
	catch (e) {
		log_line_error(screen_name, user_id, "failed to update db for last_error_code to " + error_code, e);
		return;
	}
}
exports.set_last_error = set_last_error;
