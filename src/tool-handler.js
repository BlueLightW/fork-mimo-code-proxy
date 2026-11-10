// src/tool-handler.js
// Converte tools do formato OpenAI para formato de prompt que o MiMo entende

/**
 * Converte ferramentas do formato OpenAI para um system prompt que o MiMo pode usar
 */
export function buildToolsSystemPrompt(tools, toolChoice = 'auto') {
    if (!tools || tools.length === 0) return '';
    
    let prompt = '\n\n# Available Tools\n';
    prompt += 'You have access to the following tools. When you need to use a tool, output it in the exact XML format shown below.\n\n';
    
    for (const tool of tools) {
        if (tool.type === 'function' && tool.function) {
            const func = tool.function;
            prompt += `## Tool: ${func.name}\n`;
            if (func.description) {
                prompt += `Description: ${func.description}\n`;
            }
            if (func.parameters && func.parameters.properties) {
                prompt += 'Parameters (JSON Schema):\n';
                prompt += '```json\n';
                prompt += JSON.stringify(func.parameters, null, 2);
                prompt += '\n```\n';
            }
            prompt += '\n### Usage Format:\n';
            prompt += 'To call this tool, output EXACTLY this XML structure:\n';
            prompt += '```xml\n';
            prompt += `<tool_call>\n`;
            prompt += `  <name>${func.name}</name>\n`;
            prompt += `  <arguments>\n`;
            prompt += `    { "param1": "value1", "param2": "value2" }\n`;
            prompt += `  </arguments>\n`;
            prompt += `</tool_call>\n`;
            prompt += '```\n\n';
        }
    }
    
    if (toolChoice === 'required') {
        prompt += '\n**IMPORTANT: You MUST use one or more tools to answer this question.**\n';
    } else if (toolChoice === 'none') {
        prompt += '\n**Do NOT use any tools for this request.**\n';
    }
    
    return prompt;
}

/**
 * Extrai tool calls de texto formatado em XML
 */
export function extractToolCalls(text) {
    const toolCalls = [];
    const regex = /<tool_call>\s*<name>(.*?)<\/name>\s*<arguments>(.*?)<\/arguments>\s*<\/tool_call>/gs;
    
    let match;
    let index = 0;
    
    while ((match = regex.exec(text)) !== null) {
        const name = match[1].trim();
        const argsStr = match[2].trim();
        
        try {
            const args = JSON.parse(argsStr);
            toolCalls.push({
                id: `call_${Date.now()}_${index}`,
                type: 'function',
                function: {
                    name: name,
                    arguments: argsStr
                }
            });
            index++;
        } catch (e) {
            console.warn('[ToolHandler] Failed to parse tool call arguments:', e.message);
        }
    }
    
    return toolCalls;
}

/**
 * Remove tool calls do texto e retorna apenas o conteúdo limpo
 */
export function removeToolCallsFromText(text) {
    return text.replace(/<tool_call>.*?<\/tool_call>/gs, '').trim();
}

/**
 * Verifica se há tool calls incompletos no texto (streaming)
 */
export function hasIncompleteToolCall(text) {
    return text.includes('<tool_call>') && !text.includes('</tool_call>');
}

/**
 * Encontra tool calls completos no texto
 */
export function findCompleteToolBlocks(text) {
    const blocks = [];
    const regex = /<tool_call>.*?<\/tool_call>/gs;
    
    let match;
    while ((match = regex.exec(text)) !== null) {
        blocks.push({
            start: match.index,
            end: match.index + match[0].length,
            text: match[0]
        });
    }
    
    return blocks;
}