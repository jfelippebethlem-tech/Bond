#!/bin/bash
cd /home/ubuntu/polimonitor || exit 1
/home/ubuntu/polimonitor/node_modules/.bin/tsx scripts/watch-leaderboard.ts
