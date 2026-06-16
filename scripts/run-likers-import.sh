#!/bin/bash
cd /home/ubuntu/polimonitor || exit 1
/home/ubuntu/polimonitor/node_modules/.bin/tsx scripts/import-likers-sync.ts
