#!/usr/bin/env bash
set -euo pipefail

cd contract
npm ci --no-audit --no-fund
npx fetch-compactc --version=0.31.1
npm run compile
npm run compile:v2

cd ui
npm ci --no-audit --no-fund
npm run build
