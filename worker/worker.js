
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

const norm = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function tg(env, method, body) {
  const r = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  return await r.json();
}

async function send(env, chat, text) {
  return tg(env, "sendMessage", {
    chat_id: chat,
    text,
    disable_web_page_preview: true
  });
}

async function dispatch(env, mode, symbol = "") {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/scan.yml/dispatches`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "yusufFU-futures-bot",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { mode, symbol }
    })
  });

  return r.status === 204;
}

async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;

  const chat = String(msg.chat.id);

  if (chat !== String(env.ALLOWED_CHAT_ID)) {
    await send(env, chat, "هذا البوت خاص وغير مصرح لهذا الحساب.");
    return;
  }

  const parts = msg.text.trim().split(/\s+/);
  const cmd = parts[0].split("@")[0].toLowerCase();
  const sym = norm(parts[1] || "");

  let list = await env.BOT_KV.get("watchlist", "json") || [];
  if (!Array.isArray(list)) list = [];

  if (["/start", "/help", "/menu"].includes(cmd)) {
    await send(env, chat,
      "🤖 Smart Futures Signals\n\n" +
      "/add SOLUSDT — إضافة عملة\n" +
      "/list — عرض قائمتي\n" +
      "/remove SOLUSDT — حذف عملة\n" +
      "/scanlist — فحص قائمتي\n" +
      "/scan SOLUSDT — فحص عملة\n" +
      "/scanall — فحص السوق\n" +
      "/top — أفضل الإشارات\n" +
      "/status — حالة الخدمة"
    );

  } else if (cmd === "/add") {
    if (!/^[A-Z0-9]{3,20}USDT$/.test(sym))
      return send(env, chat, "اكتب: /add SOLUSDT");

    if (!list.includes(sym)) list.push(sym);
    await env.BOT_KV.put("watchlist", JSON.stringify(list));
    await send(env, chat, `تمت إضافة ${sym} إلى قائمتك.`);

  } else if (cmd === "/list") {
    await send(env, chat,
      list.length ? "عملاتك:\n" + list.join("\n") : "قائمتك فارغة."
    );

  } else if (cmd === "/remove") {
    if (!sym) return send(env, chat, "اكتب: /remove SOLUSDT");

    list = list.filter(x => x !== sym);
    await env.BOT_KV.put("watchlist", JSON.stringify(list));
    await send(env, chat, `تم حذف ${sym} إن كانت موجودة.`);

  } else if (cmd === "/scanlist") {
    if (!list.length) return send(env, chat, "قائمتك فارغة.");

    const ok = await dispatch(env, "watchlist");
    await send(env, chat, ok
      ? "بدأ فحص قائمتك. ستصلك النتائج عند اكتمال المهمة."
      : "تعذر تشغيل الفحص. تحقق من إعدادات GitHub."
    );

  } else if (cmd === "/scan") {
    if (!/^[A-Z0-9]{3,20}USDT$/.test(sym))
      return send(env, chat, "اكتب: /scan SOLUSDT");

    const ok = await dispatch(env, "single", sym);
    await send(env, chat, ok ? `بدأ فحص ${sym}.` : "تعذر تشغيل الفحص.");

  } else if (cmd === "/scanall") {
    const ok = await dispatch(env, "all");
    await send(env, chat, ok
      ? "بدأ فحص السوق."
      : "تعذر تشغيل الفحص."
    );

  } else if (cmd === "/top") {
    const last = await env.BOT_KV.get("last_results", "json") || [];
    await send(env, chat, last.length
      ? "آخر أفضل النتائج:\n" +
        last.slice(0, 10).map(x =>
          `${x.symbol} | ${x.direction} | ${x.score}/100`
        ).join("\n")
      : "لا توجد نتائج محفوظة بعد."
    );

  } else if (cmd === "/status") {
    await send(env, chat,
      `الخدمة تعمل.\nعدد عملات قائمتك: ${list.length}\nالفحص المجدول: كل 30 دقيقة تقريباً.`
    );

  } else {
    await send(env, chat, "أمر غير معروف. أرسل /help.");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/setup") {
      if (url.searchParams.get("key") !== env.ADMIN_SECRET)
        return new Response("Unauthorized", { status: 401 });

      const result = await tg(env, "setWebhook", {
        url: `${url.origin}/telegram`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message"]
      });

      return json(result);
    }

    if (url.pathname === "/telegram" && request.method === "POST") {
      if (
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
        env.TELEGRAM_WEBHOOK_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const update = await request.json();
      await handleUpdate(update, env);
      return new Response("ok");
    }

    if (url.pathname === "/internal/watchlist") {
      if (request.headers.get("X-Scanner-Secret") !== env.ADMIN_SECRET)
        return new Response("Unauthorized", { status: 401 });

      const list = await env.BOT_KV.get("watchlist", "json") || [];
      return json({ symbols: list });
    }

    if (url.pathname === "/internal/results" && request.method === "POST") {
      if (request.headers.get("X-Scanner-Secret") !== env.ADMIN_SECRET)
        return new Response("Unauthorized", { status: 401 });

      const body = await request.json();
      await env.BOT_KV.put(
        "last_results",
        JSON.stringify(body.results || []),
        { expirationTtl: 86400 }
      );

      return json({ ok: true });
    }

    return new Response("yusufFU Smart Futures Signals Worker");
  }
};
