
async function testEndpoint(name, url, headers, body) {
    console.log(`\nTesting ${name} (${url})...`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        console.log(`Status: ${response.status}`);
        const text = await response.text();
        console.log(`Response: ${text.substring(0, 200)}...`);
    } catch (e) {
        console.log(`ERROR: ${e.message}`);
        if (e.cause) console.log(`Cause: ${e.cause}`);
    }
}

async function run() {
    const API_KEY = process.env.API_KEY;
    if (!API_KEY) {
        console.error("No API KEY provided");
        return;
    }

    const commonBody = {
        model: "GLM-4.6",
        messages: [{ role: "user", content: "Hello" }]
    };

    // Test 1: api.z.ai (OpenAI style) - Current Implementation
    await testEndpoint(
        "api.z.ai (OpenAI)",
        "https://api.z.ai/api/coding/paas/v4/chat/completions",
        {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY}`
        },
        commonBody
    );

    // Test 2: Standard Z.ai
    await testEndpoint(
        "open.bigmodel.cn (Standard)",
        "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY}`
        },
        commonBody
    );

    // Test 3: api.z.ai (Anthropic style)
    await testEndpoint(
        "api.z.ai (Anthropic Header)",
        "https://api.z.ai/api/anthropic/v1/messages",
        {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01"
        },
        {
            model: "GLM-4.6",
            max_tokens: 10,
            messages: [{ role: "user", content: "Hello" }]
        }
    );

}

run();
