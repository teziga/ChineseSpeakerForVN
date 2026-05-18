import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"

// 🎯 【核心防爆盾】定义标准跨域头，允许 Vercel 前端或本地静态文件跨域请求
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // 1. 🎯 【关键修复】必须处理浏览器的 OPTIONS 预检请求，否则线上环境必报 Load failed
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // 2. 严格限制必须是 POST 传输
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed" }), 
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  try {
    // 3. 从云端沙箱中读取你刚刚存入的 GEMINI_API_KEY
    const apiKey = Deno.env.get("GEMINI_API_KEY")
    if (!apiKey) {
      throw new Error("云端未检测到 GEMINI_API_KEY，请检查 Supabase Vault 配置")
    }

    // 4. 解析前端传过来的 JSON 数据
    const { image } = await req.json()
    if (!image) {
      throw new Error("未接收到图片数据 (image base64 is missing)")
    }

    // 5. 🎯 【旗舰升级】将已被谷歌废弃的 gemini-pro-vision 完美替换为全新的 gemini-2.5-flash
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    
    const prompt = `你是一个精准的识字与翻译助手。请识别这张图片中的所有核心中文文本（忽略零碎、模糊、不重要的背景文字）。

请严格按照以下 JSON 格式返回，不要包含任何 markdown 标记（如 \`\`\`json）：
{
  "text": "识别出的完整中文文本（如果有多行，请用空格隔开，确保语意连贯）",
  "translation": "对应的精准越南语翻译"
}`

    const geminiPayload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: image
              }
            }
          ]
        }
      ],
      // 🎯 优化新版大模型参数结构，剔除旧版过时的 topK，确保纯净兼容
      generationConfig: {
        temperature: 0.2, // 降低随机性，让翻译和识字更精准
        topP: 1,
        maxOutputTokens: 2048,
      }
    }

    // 6. 向谷歌新加坡/台湾等最近的边缘节点发起大模型请求
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(geminiPayload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini 官方返回错误: ${errorText}`)
    }

    const data = await response.json()
    
    // 7. 解析大模型吐出来的原始文本
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      throw new Error("Gemini 未返回有效的识别内容")
    }

    // 清理可能夹带的 markdown 碎屑
    const cleanJsonText = rawText.replace(/```json/g, "").replace(/```/g, "").trim()
    const result = JSON.parse(cleanJsonText)

    // 8. 🎯 【成功返回】将带有跨域头的 JSON 结果安全送回前端
    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    )

  } catch (error) {
    // 9. 🎯 【失败捕获】如果链路断裂，同样带上跨域头返回错误，方便前端 alert 弹窗捕获
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    )
  }
})