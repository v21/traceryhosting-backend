#!/bin/bash

cd $(dirname $0)

while read line; do export "$line";
done < .env


date >> run_bots.log
/home/v21/.nvm/versions/node/v5.5.0/bin/node run_bots.js $1 >> run_bots.log
echo "---" >> run_bots.log
