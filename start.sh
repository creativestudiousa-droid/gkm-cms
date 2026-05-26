#!/bin/sh
echo "=== GKM Directus CMS Starting ==="
echo "Running database bootstrap..."
npx directus bootstrap
echo "Bootstrap complete. Starting server..."
npx directus start
