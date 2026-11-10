// src/tool-handler.js

export function buildToolsSystemPrompt(tools, toolChoice = 'auto') {
    if (!tools || tools.length === 0) return '';
    
    // Prompt mais direto e específico para forçar XML puro
    let prompt = '\n\n# TOOLS AVAILABLE (MANDATORY XML FORMAT)\n';
    prompt += 'You MUST use tools when the task requires file access, shell commands, or code execution.\n';
    prompt += 'When using a tool, you MUST output EXACTLY this XML block (no markdown, no code fences):\n\n';
    prompt += '<tool_call>\n<name>FUNCTION_NAME</name>\n<arguments>{"param":"value"}</arguments>\n</tool_call>\n\n';
    prompt += 'After the tool_call, wait for the result before continuing.\n\n';
    prompt += '## Your tools:\n\n';
    
    for (const tool of tools) {
        if (tool.type === 'function' && tool.function) {
            const func = tool.function;
            prompt += `### ${func.name}\n`;
            if (func.description) prompt += `${func.description}\n`;
            if (func.parameters) {
                prompt += `Schema: ${JSON.stringify(func.parameters)}\n`;
            }
            prompt += '\n';
        }
    }
    
    if (toolChoice === 'required') {
        prompt += '\n**YOU MUST USE AT LEAST ONE TOOL IN THIS RESPONSE.**\n';
    }
    
    return prompt;
}

/**
 * Extrai tool calls de múltiplos formatos possíveis
 */
export function extractToolCalls(text) {
    const toolCalls = [];
    const seen = new Set();
    let index = 0;
    
    // Padrão 1: XML <tool_call>
    const re1 = /<tool_call>\s*<name>([^<]+)<\/name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/tool_call>/g;
    let m;
    while ((m = re1.exec(text)) !== null) {
        try {
            const name = m[1].trim();
            const argsStr = m[2].trim();
            const key = `${name}:${argsStr}`;
            if (!seen.has(key)) {
                seen.add(key);
                toolCalls.push({
                    id: `call_${Date.now()}_${index++}`,
                    type: 'function',
                    function: { name, arguments: argsStr }
                });
            }
        } catch {}
    }
    
    // Padrão 2: MiMoML <function=NAME>{...}</function>
    const re2 = /<function=([a-zA-Z_][a-zA-Z0-9_]*)>([\s\S]*?)<\/function>/g;
    while ((m = re2.exec(text)) !== null) {
        try {
            const name = m[1].trim();
            const argsStr = m[2].trim();
            const key = `${name}:${argsStr}`;
            if (!seen.has(key)) {
                seen.add(key);
                toolCalls.push({
                    id: `call_${Date.now()}_${index++}`,
                    type: 'function',
                    function: { name, arguments: argsStr }
                });
            }
        } catch {}
    }
    
    // Padrão 3: TOOL_CALL: name {json}
    const re3 = /TOOL_CALL:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(\{[\s\S]*?\})(?=\n|$)/g;
    while ((m = re3.exec(text)) !== null) {
        try {
            const name = m[1].trim();
            const argsStr = m[2].trim();
            const key = `${name}:${argsStr}`;
            if (!seen.has(key)) {
                seen.add(key);
                toolCalls.push({
                    id: `call_${Date.now()}_${index++}`,
                    type: 'function',
                    function: { name, arguments: argsStr }
                });
            }
        } catch {}
    }
    
    // Padrão 4: <|MiMoML|tool_calls>
    const re4 = /<\|MiMoML\|tool_calls>([\s\S]*?)<\/\|MiMoML\|tool_calls>/g;
    while ((m = re4.exec(text)) !== null) {
        try {
            const inner = m[1].trim();
            // Tenta parsear como JSON array
            const arr = JSON.parse(inner);
            if (Array.isArray(arr)) {
                for (const item of arr) {
                    if (item.name && item.arguments !== undefined) {
                        const argsStr = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments);
                        const key = `${item.name}:${argsStr}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            toolCalls.push({
                                id: `call_${Date.now()}_${index++}`,
                                type: 'function',
                                function: { name: item.name, arguments: argsStr }
                            });
                        }
                    }
                }
            }
        } catch {}
    }
    
    return toolCalls;
}

/**
 * Remove TODOS os formatos de tool calls do texto
 */
export function removeToolCallsFromText(text) {
    return text
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .replace(/<function=[a-zA-Z_][a-zA-Z0-9_]*>[\s\S]*?<\/function>/g, '')
        .replace(/TOOL_CALL:\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\{[\s\S]*?\}(?=\n|$)/g, '')
        .replace(/<\|MiMoML\|tool_calls>[\s\S]*?<\/\|MiMoML\|tool_calls>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Detecta se o modelo está apenas FALANDO sobre tool calls em vez de realmente chamá-los
 */
export function detectFakeToolCalls(text, availableTools) {
    if (!availableTools || availableTools.length === 0) return { fake: false };
    
    const toolNames = availableTools
        .filter(t => t.type === 'function' && t.function)
        .map(t => t.function.name);
    
    // Verifica se o texto menciona nomes de tools sem ter chamado
    const mentionedTools = toolNames.filter(name => {
        const regex = new RegExp(`\\b${name}\\b`, 'i');
        return regex.test(text);
    });
    
    const hasRealCalls = extractToolCalls(text).length > 0;
    
    if (mentionedTools.length > 0 && !hasRealCalls) {
        return {
            fake: true,
            mentionedTools,
            hint: `O modelo mencionou tools (${mentionedTools.join(', ')}) mas não emitiu chamadas reais.`
        };
    }
    
    return { fake: false };
}

export function hasIncompleteToolCall(text) {
    return (
        (text.includes('<tool_call') && !text.includes('</tool_call>')) ||
        (text.match(/<function=[a-zA-Z_][a-zA-Z0-9_]*>/) && !text.includes('</function>'))
    );
}