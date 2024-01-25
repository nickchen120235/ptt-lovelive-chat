import { load } from "dotenv"
import { parse } from "node-html-parser"

const env = await load()
const DISCORD_WEBHOOK_URL = env['DISCORD_WEBHOOK_URL']
const kv = await Deno.openKv()

class HttpError extends Error {
  constructor(res: Response) {
    super(`Server returned ${res.status} when fetching ${res.url}`)
    this.name = this.constructor.name
  }
}

Deno.cron('ptt-lovelive-chat', '*/10 * * * *', async () => {
  try {
    // load main page
    const res = await fetch('https://www.ptt.cc/bbs/LoveLive_Sip/index.html')
    if (!res.ok) throw new HttpError(res)
    const html = await res.text()
    const root = parse(html)
    const posts = root.querySelectorAll('div.title > a')
      .filter(post => post.innerText.includes('閒聊') && post.innerText.includes('公告'))
    console.log(`Got ${posts.length} posts.`)

    for (const post of posts) {
      console.log(`processing ${post.innerText}`)
      // get pushes for every post
      const res = await fetch(`https://www.ptt.cc${post.getAttribute('href')}`)
      if (!res.ok) throw new HttpError(res)
      const html = await res.text()
      const root = parse(html)
      const start = (await kv.get<number>([post.innerText])).value ?? 0
      const pushes = root.querySelectorAll('div.push').slice(start).map(push => {
        const [_type, _user, _content, _time] = push.childNodes
        const type = _type.innerText
        const user = _user.innerText
        const content = _content.innerText
        const time = _time.innerText.trimEnd()
        return type + user + content + time
      })
      console.log(`Got ${pushes.length} new pushes.`)
      if (start !== 0) {
        for (const push of pushes) {
          const res = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              username: post.innerText,
              content: push
            })
          })
          if (!res.ok) throw new HttpError(res)
        }
      }
      await kv.set([post.innerText], start + pushes.length)
    }
  }
  catch (e) {
    if (e instanceof Error) {
      console.error(`${e.name}: ${e.message}`)
    }
    else {
      console.error(JSON.stringify(e))
    }
  }
})
