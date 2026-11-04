# Demo video shot list

Target: under 3:00, 1920×1080, English captions only, no voice. Scored under Demo (25%), and the video is also what judges see of Impact (30%) and Meta AI tooling (25%), so every shot either shows who this is for or a Meta model doing visible work.

Shots marked **model** need the real Meta key; the rest record on the local worker.

| # | Time | Shot | Caption | Needs |
|---|---|---|---|---|
| 1 | 0:00–0:10 | The room fades up. The owner walks in; Muse stands behind the counter. Boxes are waiting on the counter. | My AI agent shops for me. Then the things it picked vanish into a cart I never look at. | |
| 2 | 0:10–0:14 | Title card over the room. | Cart Showroom: a room where my Muse shows me what she noted. | |
| 3 | 0:14–0:34 | Slice the tape on one box. The 3D stage opens: flaps spring, filler bursts, the product rises with Muse's handwritten note, then flies to the shelf. | Every item arrives as a parcel. Muse tucks in a note: why she picked it. | |
| 4 | 0:34–0:46 | "Open all" on the rest: the pull row, a rare sticker, the result cards, "Shelve all". | Open the rest at once. Some parcels hide a sticker. | |
| 5 | 0:46–1:08 | Talk to Muse: "What is on my shelf?" The `cart_list` chip appears above her reply; she answers from the cart. | Muse Spark 1.3 runs the clerk, calling the same six cart tools my own Muse uses over MCP. | **model** |
| 6 | 1:08–1:22 | Open the list, take an item out, pick "Already have it". Undo bar for five seconds. | Taking something out asks why. | |
| 7 | 1:22–1:40 | Tell Muse "I took some things out. Remember my taste." She reads the removal and its reason and answers in kind. | She reads why, and remembers it next time she shops. | **model** |
| 8 | 1:40–2:00 | "Make an intro video of my cart." `promo_generate` chip; the script is checked (no checkout words, no hidden prices, each line matches its shelf slot). | Muse writes the intro script in my voice. The showroom checks every line. | **model** |
| 9 | 2:00–2:25 | Time-lapse of the runner: storyboard, render, Spark watching keyframes and fixing overflowing subtitles, then the finished intro playing in the Promo panel (5–8 s of it). | Spark writes the storyboard, Remotion renders it, Spark watches the keyframes and fixes what it catches. | **model** + runner |
| 10 | 2:25–2:40 | Share panel: turn sharing on, hide prices. Cut to the visitor page in a second window: the visitor unboxes their own parcels, no prices anywhere. | Share the room. Visitors open their own parcels, and see only what I chose to show. | |
| 11 | 2:40–2:50 | Switch to 繁體中文: the room, Muse's reply and the intro all follow. | It speaks my language too. | **model** for the reply |
| 12 | 2:50–2:58 | Connections panel showing Muse Code's last `cart_add` over `/mcp`. End card. | Built for my world: an agent that shops, and a room that shows me what it did. | a real Muse Code call (the `muse` CLI is not installed here) |

## Rules the cut follows

- New work only. The furniture comes from my earlier PA Cafe project, so it stays as set dressing, never the subject of a shot.
- No fake model output. Shots 5, 7, 8, 9 and 11 are recorded against the real Meta Model API, never the local fake API.
- Captions sit top left on the empty back wall, clear of the counter's parcel panel and the HUD, at most three lines, up at least 2.5 s.
- The demo cart is six made-up items in English (made-up stores, links to example.com), each with a free-licence photo from Unsplash (unsplash.com/license; no attribution required): photo IDs 1783206695207-aa4deabafa7b, 1505740420928-5e560c06d30e, 1544816155-12df9643f363, 1637739699971-7d4d5194e75c, 1612529376930-9734e04e6910, 1604300026894-75f90702c181.
- Recorded headless on the GPU (Metal) at 1920×1080. Measured: the room draws 60 frames a second and the capture gets about 40; the software renderer the test scripts use gets about 2.
