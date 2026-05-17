import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// 🔒 引入标准库的 Base64 编码工具，保障大体积拍照图片安全编码，防止内存爆栈
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 处理跨域预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 🛡️ 安全地将前端传来的图片流读取为 Uint8Array 字节数组
    const arrayBuffer = await req.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    if (uint8Array.length === 0) {
      throw new Error("接收到的图片数据为空");
    }
    
    // 将字节数组高效转换为 Base64 编码
    const base64Image = encode(uint8Array);

    // 从环境变量获取你的免费 Gemini API Key
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error("云端未配置 GEMINI_API_KEY");

    // 优化后的结构化 Prompt
    const prompt = `你是一个多模态 OCR 兼翻译专家。请帮我提取这张图片中的所有中文文字，并将其翻译成越南语。
你必须严格、只能返回如下格式的标准 JSON 字符串，不要包含任何 \`\`\` 标记，不要有解释：
{
  "text": "提取出的中文纯文本内容",
  "translation": "对应的越南语翻译内容"
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini 官方返回错误: ${errText}`);
    }

    const resData = await response.json();
    let replyText = resData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
    
    console.log("Gemini 原始返回内容:", replyText);

    // 🎯 【黑科技防爆盾】：用正则表达式，强行洗掉大模型可能自带的 ```json 或 ``` 标记
    replyText = replyText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();

    // 尝试安全解析 JSON
    let finalResult;
    try {
        finalResult = JSON.parse(replyText);
    } catch (e) {
        console.error("JSON 解析失败，尝试从文本中强行清洗提取...");
        // 极端兜底方案：如果大模型彻底抽风没给 JSON，就把整段文本作为中文，确保前端不崩溃
        finalResult = { text: replyText, translation: "Dịch格式解析失败，请重试" };
    }

    return new Response(
      JSON.stringify({
        text: finalResult.text || "",
        translation: finalResult.translation || "",
        audio: "" 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("云函数捕获硬核错误:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
})