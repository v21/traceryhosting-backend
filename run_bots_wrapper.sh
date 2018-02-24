#!/bin/bash

cd $(dirname $0)

while read line; do export "$line";
done < .env

$NODE_PATH run_bots.js $1 >> run_bots.log
