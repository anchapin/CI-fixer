npm run dev &
DEV_PID=$!
sleep 15
npx playwright test
kill $DEV_PID
