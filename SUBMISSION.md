# Cart Showroom

A small 3D room that shows what your Muse noted while shopping for you. Muse is the clerk; you are the owner. Nothing here
checks out or links to a store's cart: the room keeps the notes, lets you tidy them, and turns them into a short intro
video you host yourself.

## What judges can try in the room

Open the room and press **Talk to Muse**. The built-in clerk runs on the Meta Model API and uses the same six cart tools
an owner's own Muse Code gets over MCP.

A two-minute path:

1. Ask **"What is on my shelf?"** Muse calls `cart_list` and answers from it. Each tool she used shows above her reply.
2. Open the list and take an item out. Pick a reason, such as *Already have it*. You get five seconds to undo.
3. Tell Muse **"I took some things out. Remember my taste."** She reads the removal and its reason through
   `cart_list` and answers in kind. If she is asked to note that item again later, `cart_add` reminds her to ask
   you first.
4. Ask **"Make an intro video of my cart."** Muse calls `promo_generate` with a script in your first-person voice. The
   showroom checks the script: no checkout wording, no prices when you hide them, and each line has to match the item at
   that place on the shelf.
5. The runner renders the video with Remotion. You host it from the room's studio set, and it shows in the **Promo** panel.

Switch the interface between English and 繁體中文 from the header. The language you are in carries through:

- the clerk replies in it,
- the habits report reads in it,
- the intro video is made in it: subtitles, title cards, and the voice when one is set up.

## Where Meta's models are used

| Part | Model | What it does |
| --- | --- | --- |
| Built-in clerk (`/api/clerk`) | `muse-spark-1.3`, function calling on `/chat/completions` | Reads and changes the cart, reads the habits report, writes and queues the intro script. It makes at most 8 tool calls and 6 model requests per turn, and the last request asks for words only. |
| Intro storyboard (runner) | `muse-spark-1.3`, JSON mode | Writes subtitles for any scene the clerk's script left out. |
| Intro QA (runner) | `muse-spark-1.3`, with keyframes | Flags subtitles that overflow, pacing that is too fast, or checkout wording. The fixes are applied before the final render. |
| Owner character (optional) | `muse-image-1.0` | Turns the owner's photo into a walking sprite for the room. |

**Extension: your own Muse Code.** The same tools are served at `/mcp`. Point Muse Code at it, add the
`showroom-cart` and `showroom-promo` skills, and your everyday Muse records real purchases into the room as she shops.
The **Connections** panel shows when Muse last called and which tool she used.

## Keys and limits

- **House key.** The hosted demo uses a worker secret, capped by a daily spend (`CLERK_DAILY_USD`, default $2). Spend is
  estimated from each reply's token usage at Spark's published prices.
- **Your own key.** Past the cap, the panel asks for your own Meta API key. It is kept with the showroom, used only for
  the clerk, and shown by its last four characters only. Keys are scrubbed from error messages.
- **Owner only.** The clerk and all write routes need the owner. A shared showroom page (`/s/<slug>`) can only view.

## Built with

React 19 and three.js for the room. A Cloudflare Worker and a Durable Object hold the cart, the conversation and the jobs.
Remotion renders the video. zod defines the schemas, and vitest runs the tests. The furniture, the studio set and the
clerk character come from PA Cafe.

Not affiliated with, endorsed by, or sponsored by Meta. pacafe-cart-showroom uses Meta's Muse models via the Meta Model API.
