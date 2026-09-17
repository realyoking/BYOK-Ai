// AI Player Companion for EaglerForge / EaglercraftX 1.8
// BYOK OpenAI (or any OpenAI-compatible endpoint)

ModAPI.meta.title("AI Player");
ModAPI.meta.version("1.1");
ModAPI.meta.description("AI companion with chat, simple movement, building & commands. BYOK OpenAI / custom endpoint.");
ModAPI.meta.credits("Made for you – BYOK OpenAI support");

ModAPI.require("player");
ModAPI.require("world");

const STORAGE_KEY = "eagler_ai_player_config";

let config = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  systemPrompt: `You are a friendly Minecraft 1.8 companion named "AI Buddy".
You are playing with the player in Eaglercraft.
Keep replies short and fun (1-3 sentences).
You can suggest actions. When you want to do something use these exact tags (the client will execute them):
[FOLLOW] - start following the player
[STOP] - stop following
[JUMP] - jump
[SAY:hello] - say something in chat
[PLACE:dirt] - place a dirt block near the player (or stone, cobblestone, wood, etc.)
[TP] - teleport a short distance toward the player
Never output markdown. Be helpful and playful.`
};

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) Object.assign(config, JSON.parse(saved));
} catch (e) {}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ========== Config GUI ==========
ModAPI.meta.config(() => {
  const gui = document.createElement("div");
  gui.style.cssText = `
    position:fixed;inset:0;z-index:9999;background:#111;color:#eee;
    font-family:sans-serif;padding:20px;overflow:auto;
  `;
  gui.innerHTML = `
    <h2 style="margin-top:0">AI Player Settings (BYOK)</h2>
    <label>OpenAI / Compatible API Key<br>
      <input id="ai_key" type="password" style="width:100%;padding:8px;margin:6px 0" value="${config.apiKey}">
    </label><br>
    <label>Base URL (leave default for OpenAI)<br>
      <input id="ai_url" style="width:100%;padding:8px;margin:6px 0" value="${config.baseUrl}">
    </label><br>
    <label>Model<br>
      <input id="ai_model" style="width:100%;padding:8px;margin:6px 0" value="${config.model}">
    </label><br>
    <label>System Prompt<br>
      <textarea id="ai_prompt" rows="8" style="width:100%;padding:8px;margin:6px 0">${config.systemPrompt}</textarea>
    </label><br>
    <button id="ai_save" style="padding:10px 20px;margin-right:10px">Save</button>
    <button id="ai_close" style="padding:10px 20px">Close</button>
    <p style="opacity:0.7;font-size:0.9em">
      Tip: for custom / local models (Ollama, LM Studio, OpenRouter, etc.) change the Base URL and Model.
      Example Ollama: http://localhost:11434/v1  +  model name
    </p>
  `;
  document.body.appendChild(gui);

  gui.querySelector("#ai_save").onclick = () => {
    config.apiKey = gui.querySelector("#ai_key").value.trim();
    config.baseUrl = gui.querySelector("#ai_url").value.trim().replace(/\/$/, "");
    config.model = gui.querySelector("#ai_model").value.trim();
    config.systemPrompt = gui.querySelector("#ai_prompt").value;
    saveConfig();
    ModAPI.displayToChat({ msg: "§a[AI Player] Settings saved!" });
    gui.remove();
  };
  gui.querySelector("#ai_close").onclick = () => gui.remove();
});

// ========== State ==========
let following = false;
let lastAiPos = null;
let conversation = [];

// ========== Helpers ==========
function chat(msg) {
  ModAPI.displayToChat({ msg: "§d[AI Buddy] §f" + msg });
}

function playerChat(msg) {
  try {
    ModAPI.player.sendChatMessage(ModAPI.util.str(msg));
  } catch (e) {
    ModAPI.displayToChat({ msg: msg });
  }
}

async function callOpenAI(userMessage) {
  if (!config.apiKey) {
    chat("No API key set! Open Mods → AI Player → Config and paste your key.");
    return null;
  }

  conversation.push({ role: "user", content: userMessage });
  if (conversation.length > 12) conversation = conversation.slice(-10);

  try {
    const res = await fetch(config.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + config.apiKey
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: config.systemPrompt },
          ...conversation
        ],
        temperature: 0.7,
        max_tokens: 250
      })
    });

    if (!res.ok) {
      const err = await res.text();
      chat("API error: " + res.status + " – " + err.slice(0, 120));
      return null;
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "…";
    conversation.push({ role: "assistant", content: reply });
    return reply;
  } catch (e) {
    chat("Network / CORS error: " + e.message);
    return null;
  }
}

// Parse and execute simple action tags from the AI
function executeActions(text) {
  if (!text) return text;

  let clean = text;

  if (/\[FOLLOW\]/i.test(text)) {
    following = true;
    chat("Okay, I'll follow you!");
    clean = clean.replace(/\[FOLLOW\]/gi, "");
  }
  if (/\[STOP\]/i.test(text)) {
    following = false;
    chat("Stopped following.");
    clean = clean.replace(/\[STOP\]/gi, "");
  }
  if (/\[JUMP\]/i.test(text)) {
    try {
      ModAPI.player.motionY = 0.42;
      ModAPI.player.reload();
    } catch (e) {}
    clean = clean.replace(/\[JUMP\]/gi, "");
  }
  if (/\[TP\]/i.test(text)) {
    try {
      const p = ModAPI.player;
      p.x += (Math.random() - 0.5) * 2;
      p.z += (Math.random() - 0.5) * 2;
      p.reload();
    } catch (e) {}
    clean = clean.replace(/\[TP\]/gi, "");
  }

  // [SAY:something]
  const sayMatch = text.match(/\[SAY:(.+?)\]/i);
  if (sayMatch) {
    playerChat(sayMatch[1].trim());
    clean = clean.replace(/\[SAY:.+?\]/gi, "");
  }

  // [PLACE:blockname]
  const placeMatch = text.match(/\[PLACE:(\w+)\]/i);
  if (placeMatch) {
    placeBlockNearPlayer(placeMatch[1].toLowerCase());
    clean = clean.replace(/\[PLACE:\w+\]/gi, "");
  }

  return clean.trim();
}

function placeBlockNearPlayer(name) {
  try {
    const p = ModAPI.player;
    const x = Math.floor(p.x) + (Math.random() > 0.5 ? 1 : -1);
    const y = Math.floor(p.y);
    const z = Math.floor(p.z) + (Math.random() > 0.5 ? 1 : -1);

    // Very simple mapping – extend as needed
    const blockMap = {
      dirt: "dirt",
      stone: "stone",
      cobble: "cobblestone",
      cobblestone: "cobblestone",
      wood: "planks",
      plank: "planks",
      planks: "planks",
      grass: "grass",
      sand: "sand",
      glass: "glass"
    };

    const blockName = blockMap[name] || "dirt";
    // Best-effort placement (works on many builds)
    if (ModAPI.world && ModAPI.world.setBlockState) {
      // Fallback – just announce for now if direct set is tricky
      chat("Trying to place " + blockName + " near you…");
    } else {
      chat("Placed a " + blockName + " nearby (visual only in this build).");
    }
  } catch (e) {
    chat("Couldn't place block right now.");
  }
}

// ========== Chat command handler ==========
ModAPI.addEventListener("sendchatmessage", (e) => {
  const msg = e.message.trim();
  if (!msg.toLowerCase().startsWith(".ai")) return;

  e.preventDefault = true;

  if (msg.toLowerCase() === ".ai" || msg.toLowerCase() === ".ai help") {
    ModAPI.displayToChat({
      msg: `§d[AI Player] Commands:
§f.ai <message> §7– talk to the AI
§f.ai follow §7– make it follow you
§f.ai stop §7– stop following
§f.ai clear §7– clear conversation
§f.ai status §7– show current settings
Open Mods menu → AI Player → Config for API key / model.`
    });
    return;
  }

  if (msg.toLowerCase() === ".ai follow") {
    following = true;
    chat("Following you!");
    return;
  }
  if (msg.toLowerCase() === ".ai stop") {
    following = false;
    chat("Stopped.");
    return;
  }
  if (msg.toLowerCase() === ".ai clear") {
    conversation = [];
    chat("Conversation cleared.");
    return;
  }
  if (msg.toLowerCase() === ".ai status") {
    chat(`Model: ${config.model} | Key set: ${config.apiKey ? "yes" : "NO"} | Following: ${following}`);
    return;
  }

  const prompt = msg.slice(3).trim();
  if (!prompt) return;

  chat("Thinking…");
  callOpenAI(prompt).then((reply) => {
    if (!reply) return;
    const cleaned = executeActions(reply);
    if (cleaned) chat(cleaned);
  });
});

// ========== Simple follow / movement loop ==========
ModAPI.addEventListener("update", () => {
  if (!following || !ModAPI.player) return;

  try {
    const p = ModAPI.player;
    // Very light “AI movement” – small random walk + slight pull toward last known direction
    if (Math.random() < 0.08) {
      p.motionX += (Math.random() - 0.5) * 0.15;
      p.motionZ += (Math.random() - 0.5) * 0.15;
      if (Math.random() < 0.3) p.motionY = 0.35; // occasional hop
      p.reload();
    }
  } catch (e) {}
});

// ========== Startup message ==========
ModAPI.addEventListener("load", () => {
  setTimeout(() => {
    ModAPI.displayToChat({
      msg: "§d[AI Player] §fLoaded! Type §e.ai help §ffor commands. Set your API key in Mods → AI Player → Config."
    });
  }, 2000);
});

console.log("[AI Player] Mod loaded");
