import { parse } from "node-html-parser"

const DISCORD_WEBHOOK_URL = Deno.env.get("DISCORD_WEBHOOK_URL")!
const kv = await Deno.openKv()

class HttpError extends Error {
  res: Response
  constructor(res: Response) {
    super(`Server returned ${res.status} when fetching ${res.url}`)
    this.name = this.constructor.name
    this.res = res
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
      const name = post.innerText.slice(5)
      console.log(`processing ${name}`)
      // get pushes for every post
      const res = await fetch(`https://www.ptt.cc${post.getAttribute('href')}`)
      if (!res.ok) throw new HttpError(res)
      const html = await res.text()
      const root = parse(html)
      const start = (await kv.get<number>([name])).value ?? 0
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
        let count = 0
        try {
          for (const push of pushes) {
            const res = await fetch(DISCORD_WEBHOOK_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                username: name,
                content: push
              })
            })
            if (!res.ok) throw new HttpError(res)
            count += 1;
          }
        }
        catch (e) {
          if (e instanceof HttpError) {
            console.error(`${e.name}: ${e.message}`)
            if (e.res.status === 429) {
              const error = await e.res.json()
              console.error('We\'re being rate-limited')
              console.error(`${error['message']}, retry after ${error['retry_after']} sec`)
              console.error(JSON.stringify(e.res.headers))
            }
            console.error('Not all new comments are sent!')
          }
        }
        finally {
          await kv.set([name], start + pushes.length)
        }
      }
      else {
        console.log('New post')
        await kv.set([name], pushes.length)
      }
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
