#!/bin/bash

cd $(dirname $0)

while read line; do export "$line";
done < .env

$NODE_PATH run_bots.js $1 >> logs/run_bots.log 2>>logs/run_bots_error.log
