These instructions assume you've already set up the front end side of this: if not, get you to `https://github.com/v21/traceryhosting-frontend` and at least read the README there.

Back? Okay.

- install node & mysql
- clone this repo
- run `npm update` to fetch dependencies
- make a copy of `.env.example` as `.env`. fill it out! this should track `credentials.php` from the front end pretty closely. the one exception is the database user - for the this end this is `tracery_node`, not `tracery_php`. so make sure you have the passwords right/both users set up.


CBDQ itself runs on a series of cron entries, calling `run_bots_wrapper.sh` with an argument specifying the frequency it's running at. you can manually test by running `run_bots_wrapper.sh 10` from the command line (assume you have examples with a frequency of every ten minutes in your db)
