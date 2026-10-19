# Pool rooms: the online server of Pool Physics

`worker.js` is a Cloudflare Worker with one Durable Object (`PoolRoom`) per
room. It keeps the game state of two players, so a game can wait days
between shots, and it pushes each shot to an open page over a WebSocket.
The page client is `../online.js`. Until `POOL_URL` in that file has a URL,
the Online section of the page says that the server is not deployed.

The repository holds no password text. The Worker gets two secrets:
`PASS_SALT` (random text) and `PASS_HASH` (SHA-256 of `salt:password`, hex).

## Deploy

Run these commands in this folder (`stella-nova/pages/billiard/worker`).

1. Log in to Cloudflare:

   ```sh
   npx wrangler login
   ```

2. Make a salt and keep it in a shell variable:

   ```sh
   SALT=$(openssl rand -hex 16)
   ```

3. Set the salt as a secret:

   ```sh
   printf '%s' "$SALT" | npx wrangler secret put PASS_SALT
   ```

4. Type the password at the prompt (it does not show), then set its hash:

   ```sh
   read -rs PW; printf '%s:%s' "$SALT" "$PW" | shasum -a 256 | cut -d' ' -f1 | npx wrangler secret put PASS_HASH; unset PW
   ```

5. Deploy:

   ```sh
   npx wrangler deploy
   ```

6. Copy the printed URL (`https://pool-rooms.<account>.workers.dev`).
   Paste it into `const POOL_URL = ''` in `../online.js`, then commit and
   push the site.

If `wrangler secret put` asks to make the Worker first, run step 5 first,
then steps 3 and 4. To change the password later, run steps 2 to 4 again.
Rooms made before a change keep their seats, because a seat key does not
use the password.

Check the server:

```sh
curl https://pool-rooms.<account>.workers.dev/
```

The answer is `pool-rooms ok`.

## Local test

```sh
npx wrangler dev --local --port 8790
```

Put the secrets for local runs in `.dev.vars` in this folder. Do not
commit that file. Then, in the browser console of the page, run
`localStorage.setItem('billiard.server', 'http://localhost:8790')` and
reload.

## Rules of the server

- Create and join need the password. The server compares hashes.
- A join gives a seat key (128 random bits). The page keeps it in
  `localStorage`. The room keeps only a hash of it. A third join gets
  "room full".
- A shot is accepted only from the seat whose turn it is, and only when
  its `from` equals the room version. Else the answer is 409.
- The shooter's page runs the physics and the rules, and sends the input
  and the end state. The other page plays the shot again from the input,
  then sets the balls to the end state.
- A room with no write for 30 days is deleted by its alarm.
- Create: 5 a minute (binding) and 12 an hour (memory) for each IP hash.
  Join: 20 a minute and 60 an hour.
- No names, email or IP addresses are stored. Workers Logs is off.

Node tests: `node ../tests.mjs online` (no Cloudflare account needed).
