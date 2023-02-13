#!/bin/bash

cd $(dirname $0)

while read line; do export "$line";
done < .env

starttime=$(date -u)

echo "$starttime running, args: $1 " >> logs/execution/$1.log
#timeout 3h 
$NODE_PATH run_bots.js $1 >> logs/run_bots.log 2>>logs/run_bots_error.log


echo "$(date -u) completed, args: $1, starttime: $starttime, exit code: $? " >> logs/execution/$1.log
