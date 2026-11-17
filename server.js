import express from "express";
import crypto from "crypto";
import fs from "fs";

const TOKEN = process.env.BOT_TOKEN;
const URL_ = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
const API = `https://api.telegram.org/bot${TOKEN}`;
const call = (m, b) => fetch(`${API}/${m}`, { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());

const DB = "db.json";
const db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB)) : {};
const save = () => fs.writeFileSync(DB, JSON.stringify(db));

const SHOP = {
  bread:  { stars: 5,  title: "Золотой хлеб", desc: "Полная сытость", fx: s => s.hunger = 100 },
  crown:  { stars: 50, title: "Корона",       desc: "Аксессуар",      fx: s => s.items.push("crown") },
  shades: { stars: 25, title: "Очки",         desc: "Аксессуар",      fx: s => s.items.push("shades") },
  gift:   { stars: 100, title: "Подарок другу", desc: "Настоящий TG-подарок", gift: true },
};

function verify(initData) {
  const p = new URLSearchParams(initData); const hash = p.get("hash"); p.delete("hash");
  const str = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const h = crypto.createHmac("sha256", key).update(str).digest("hex");
  if (h !== hash) return null;
  return JSON.parse(p.get("user"));
}
function get(u) {
  const s = db[u.id] ??= { name: u.first_name, hunger: 80, mood: 80, energy: 80, xp: 0,
    items: [], streak: 0, last: 0, tick: Date.now(), day: "" };
  const h = (Date.now() - s.tick) / 3.6e6; s.tick = Date.now();
  s.hunger = Math.max(0, s.hunger - h * 4); s.mood = Math.max(0, s.mood - h * 3);
  s.energy = Math.min(100, s.energy + (s.sleeping ? h * 20 : -h * 1)); if (s.energy >= 100) s.sleeping = false;
  return s;
}
const clamp = v => Math.max(0, Math.min(100, v));

const app = express(); app.use(express.json());
app.get("/tonconnect-manifest.json", (req, res) => res.json({
  url: URL_, name: "Duck Companion",
  iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/1f986.png" }));
app.use(express.static("public"));
const auth = (req, res, next) => { const u = verify(req.body.initData || "");
  if (!u) return res.status(401).end(); req.u = u; req.s = get(u); next(); };

app.post("/api/state", auth, (req, res) => {
  const { s } = req, day = new Date().toDateString();
  if (s.day !== day) { s.streak = (Date.now() - s.last < 48 * 3.6e6) ? s.streak + 1 : 1;
    s.day = day; s.last = Date.now(); s.xp += 10 * s.streak; s.bonus = true; } else s.bonus = false;
  save(); res.json({ ...s, shop: SHOP });
});
app.post("/api/act", auth, (req, res) => {
  const { s } = req, a = req.body.action;
  if (a === "feed") { s.hunger = clamp(s.hunger + 20); s.xp += 2; }
  if (a === "play") { s.mood = clamp(s.mood + 20); s.energy = clamp(s.energy - 8); s.xp += 3; }
  if (a === "sleep") s.sleeping = true;
  if (a === "gift") { s.mood = clamp(s.mood + 30); s.xp += 15; }
  save(); res.json({ ...s, shop: SHOP });
});
app.post("/api/invoice", auth, async (req, res) => {
  const sku = SHOP[req.body.sku]; if (!sku) return res.status(400).end();
  const r = await call("createInvoiceLink", { title: sku.title, description: sku.desc,
    payload: JSON.stringify({ sku: req.body.sku, uid: req.u.id, to: req.body.to || req.u.id }),
    currency: "XTR", prices: [{ label: sku.title, amount: sku.stars }] });
  res.json({ link: r.result });
});
app.post("/api/top", (req, res) => res.json(Object.values(db)
  .sort((a, b) => b.xp - a.xp).slice(0, 20).map(s => ({ name: s.name, xp: Math.floor(s.xp) }))));

app.post("/bot", async (req, res) => {
  const u = req.body; res.end();
  if (u.pre_checkout_query) return call("answerPreCheckoutQuery", { pre_checkout_query_id: u.pre_checkout_query.id, ok: true });
  const pay = u.message?.successful_payment;
  if (pay) {
    const { sku, uid, to } = JSON.parse(pay.invoice_payload), item = SHOP[sku], s = db[uid];
    if (item.gift) {
      const gifts = (await call("getAvailableGifts", {})).result.gifts
        .filter(g => g.star_count <= 100).sort((a, b) => b.star_count - a.star_count);
      if (gifts[0]) await call("sendGift", { user_id: Number(to), gift_id: gifts[0].id, text: "От твоей утки 🦆" });
    } else item.fx(s);
    s.xp += item.stars; save();
  }
  if (u.message?.text?.startsWith("/start"))
    call("sendMessage", { chat_id: u.message.chat.id, text: "🦆 Твоя утка ждёт!",
      reply_markup: { inline_keyboard: [[{ text: "Открыть", web_app: { url: URL_ } }]] } });
});
app.listen(process.env.PORT || 3000, async () => {
  console.log("up", URL_);
  console.log(await call("setWebhook", { url: `${URL_}/bot` }));
  console.log(await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Утка", web_app: { url: URL_ } } }));
});
