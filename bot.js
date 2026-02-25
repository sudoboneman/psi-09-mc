/* PSI-09 Minecraft Client
   Server: 6b6t.org
   Version: 1.21.10
   Fix: "Coordinate Lock" - Stops based on XYZ math, ignoring chunk lag.
*/

const mineflayer = require('mineflayer')
const { mineflayer: mineflayerViewer } = require('prismarine-viewer')
const axios = require('axios')
require('dotenv').config()

const CONFIG = {
    host: 'alt.6b6t.org', 
    username: process.env.MC_USERNAME, // Now loads from .env
    auth: 'offline',        
    version: '1.21.10',
    mcPassword: process.env.MC_PASSWORD || 'your_secure_password',
    engineUrl: process.env.ENGINE_URL, // Now loads from .env
    viewPort: 3007
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let bot

function createBot() {
    let hasLoggedIn = false
    let isActive = false
    let isReconnecting = false
    let lastPosition = null

    // Check if env vars are loaded to prevent crashing
    if (!CONFIG.username || !CONFIG.engineUrl) {
        console.error('Error: MC_USERNAME or ENGINE_URL is missing from .env file')
        process.exit(1)
    }

    console.log(`[Init] Connecting to ${CONFIG.host} as ${CONFIG.username}...`)

    bot = mineflayer.createBot({
        host: CONFIG.host,
        username: CONFIG.username,
        auth: CONFIG.auth,
        version: CONFIG.version,
        hideErrors: false,
        checkTimeoutInterval: 120 * 1000,
        viewDistance: 'tiny' 
    })

    // --- VISUALS ---
    bot.once('spawn', () => {
        try {
            mineflayerViewer(bot, { port: CONFIG.viewPort, firstPerson: true, viewDistance: 3 })
            console.log(`[Visuals] http://localhost:${CONFIG.viewPort}`)
        } catch (e) {}
    })

    bot.on('spawn', async () => {
        const pos = bot.entity.position
        if (!lastPosition) lastPosition = pos.clone()

        if (!hasLoggedIn) {
            console.log(`[Spawn] Landed at ${Math.floor(pos.x)}, ${Math.floor(pos.z)}`)
            await sleep(2000) 
            
            console.log('[Login] Authenticating...')
            bot.chat(`/login ${CONFIG.mcPassword}`)
            hasLoggedIn = true
            
            // Failsafe: Check if already at Limbo
            if (Math.abs(pos.z + 999) < 20) {
                 console.log('[Spawn] Already at Limbo. Executing move...')
                 performLimboLock()
            } else {
                 waitForTeleport('Limbo', performLimboLock)
            }
        }
    })

    function waitForTeleport(destinationName, nextAction) {
        console.log(`[${destinationName}] Waiting for teleport...`)
        const checkInterval = setInterval(async () => {
            if (!bot || !bot.entity) { clearInterval(checkInterval); return; }

            const currentPos = bot.entity.position
            const distance = currentPos.distanceTo(lastPosition)

            if (distance > 500) {
                clearInterval(checkInterval)
                console.log(`[${destinationName}] TELEPORT CONFIRMED!`)
                lastPosition = currentPos.clone()
                bot.clearControlStates()
                
                // Wait for physics to settle
                console.log(`[${destinationName}] Stabilizing (3s)...`)
                await sleep(3000) 
                
                nextAction()
            } else {
                if (distance < 20) lastPosition = currentPos.clone()
            }
        }, 200)
    }

    // --- COORDINATE LOCK NAVIGATION ---

    async function performLimboLock() {
        // LIMBO DATA:
        // Spawn: -999.5
        // Portal Entry: -997.5
        // Kick Zone: > -997.0
        // SAFE STOP: -998.0
        
        console.log('[Limbo] Walking (Headless)... Monitor: Z > -998.0')
        bot.setControlState('forward', true)
        bot.setControlState('sprint', false)

        const monitor = setInterval(() => {
            const z = bot.entity.position.z
            
            // We are moving Positive Z (-999 -> -997)
            // Stop BEFORE we hit -997.0
            if (z > -998.0) { 
                clearInterval(monitor)
                bot.clearControlStates() // CUT ENGINE
                console.log(`[Limbo] HARD STOP at Z=${z.toFixed(3)} (Safe Zone)`)
                waitForTeleport('Lobby', performLobbyLock)
            }
        }, 10) // High-speed check (10ms)
    }

    async function performLobbyLock() {
        // LOBBY DATA:
        // Spawn: 4.6
        // Portal Entry: 1.5
        // Kick Zone: < 1.0
        // SAFE STOP: 2.0
        
        console.log('[Lobby] Walking (Headless)... Monitor: Z < 2.0')
        bot.setControlState('forward', true)
        bot.setControlState('sprint', false)

        const monitor = setInterval(() => {
            const z = bot.entity.position.z
            
            // We are moving Negative Z (4.6 -> 1.5)
            // Stop BEFORE we hit 1.0
            if (z < 2.0) {
                clearInterval(monitor)
                bot.clearControlStates() // CUT ENGINE
                console.log(`[Lobby] HARD STOP at Z=${z.toFixed(3)} (Safe Zone)`)
                
                // Wait for world load
                setTimeout(() => {
                    console.log('[Main] Bot is now ACTIVE.')
                    isActive = true
                }, 10000)
            }
        }, 10)
    }

    // --- CHAT ---

    bot.on('kicked', (reason) => console.log('--- KICKED ---', reason))
    bot.on('end', () => {
        if (isReconnecting) return
        isReconnecting = true
        console.log(`--- DISCONNECTED ---`)
        setTimeout(createBot, 30000)
    })
    
    bot.on('message', async (jsonMsg) => {
        if (!isActive) return 
        const messageContent = jsonMsg.toString()
        console.log(`[Chat] ${messageContent}`)
        
        const match = messageContent.match(/^(\w+) whispers: (.*)$/)
        if (match) {
            const [_, sender, content] = match
            if (sender === CONFIG.username) return
            try {
                const response = await axios.post(CONFIG.engineUrl, {
                    message: content,
                    sender_id: sender,      
                    username: sender,
                    display_name: sender,
                    group_name: "6b6t_DM"
                })
                if (response.data.reply) {
                    setTimeout(() => bot.chat(`/msg ${sender} ${response.data.reply}`), 2000)
                }
            } catch (e) { }
        }
    })
}

createBot()