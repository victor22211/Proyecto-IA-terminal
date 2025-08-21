#!/usr/bin/env node

/**
 * Herramienta de línea de comandos interactiva (REPL) para modificación de código
 * usando IA a través de puter.js con Puppeteer
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

/**
 * Inicializa el trabajador de IA con Puppeteer y puter.js
 * @returns {Promise<{browser: Browser, page: Page}>}
 */
async function initAIWorker() {
    try {
        console.log('🚀 Iniciando trabajador de IA...');
        
        // Lanzar Puppeteer en modo headless
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Cargar puter.js en la página
        await page.setContent(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>AI Worker</title>
                <script src="https://js.puter.com/v2/"></script>
            </head>
            <body>
                <div id="app">AI Worker Ready</div>
            </body>
            </html>
        `);
        
        // Esperar a que puter.js se cargue completamente
        await page.waitForFunction(() => typeof window.puter !== 'undefined');
        
        console.log('🤖 Trabajador de IA con Puter.js inicializado.');
        
        return { browser, page };
    } catch (error) {
        console.error('❌ Error al inicializar el trabajador de IA:', error.message);
        throw error;
    }
}

/**
 * Obtiene el contexto completo del proyecto analizando todos los archivos
 * @param {string} dirPath - Ruta del directorio a analizar
 * @param {string} basePath - Ruta base del proyecto (para rutas relativas)
 * @returns {Promise<string>}
 */
async function getProjectContext(dirPath = process.cwd(), basePath = process.cwd()) {
    const ignoredItems = [
        'node_modules',
        '.git',
        '.vscode',
        '.DS_Store',
        'package-lock.json',
        'yarn.lock',
        'index.js', // Ignorar este mismo script
        '.env',
        'dist',
        'build',
        'coverage'
    ];
    
    const ignoredExtensions = [
        '.exe', '.dll', '.so', '.dylib',
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico',
        '.mp3', '.mp4', '.avi', '.mov',
        '.zip', '.rar', '.tar', '.gz',
        '.pdf', '.doc', '.docx'
    ];
    
    let context = '';
    
    try {
        const items = await fs.readdir(dirPath);
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const relativePath = path.relative(basePath, fullPath);
            
            // Ignorar elementos de la lista
            if (ignoredItems.includes(item)) {
                continue;
            }
            
            try {
                const stats = await fs.stat(fullPath);
                
                if (stats.isDirectory()) {
                    // Recursión para subdirectorios
                    const subContext = await getProjectContext(fullPath, basePath);
                    context += subContext;
                } else if (stats.isFile()) {
                    // Verificar extensión
                    const ext = path.extname(item).toLowerCase();
                    if (ignoredExtensions.includes(ext)) {
                        continue;
                    }
                    
                    try {
                        // Intentar leer el archivo
                        const content = await fs.readFile(fullPath, 'utf8');
                        
                        // Agregar delimitadores claros
                        context += `--- INICIO ARCHIVO: ${relativePath} ---\n`;
                        context += content;
                        context += `\n--- FIN ARCHIVO: ${relativePath} ---\n\n`;
                        
                    } catch (readError) {
                        // Ignorar archivos binarios o ilegibles
                        console.log(`⚠️  Ignorando archivo ilegible: ${relativePath}`);
                    }
                }
            } catch (statError) {
                // Ignorar elementos que no se pueden acceder
                console.log(`⚠️  No se puede acceder a: ${relativePath}`);
            }
        }
        
    } catch (error) {
        console.error(`❌ Error al leer directorio ${dirPath}:`, error.message);
    }
    
    return context;
}

/**
 * Realiza una consulta a la IA usando puter.js
 * @param {Page} page - Página de Puppeteer
 * @param {string} prompt - Prompt para la IA
 * @returns {Promise<string>}
 */
async function askAI(page, prompt) {
    try {
        console.log('🧠 Consultando a la IA...');
        
        const response = await page.evaluate(async (userPrompt) => {
            try {
                // Usar puter.ai.chat con el modelo Claude Opus 4
                const result = await puter.ai.chat(userPrompt, {
                    model: 'claude-opus-4'
                });
                
                return result;
            } catch (error) {
                throw new Error(`Error en puter.ai.chat: ${error.message}`);
            }
        }, prompt);
        
        console.log('✅ Respuesta de IA recibida');
        return response;
        
    } catch (error) {
        console.error('❌ Error al consultar la IA:', error.message);
        throw error;
    }
}

/**
 * Parsea la respuesta de la IA para extraer el archivo y código
 * @param {string} response - Respuesta cruda de la IA
 * @returns {Object|null} - {filePath: string, codeBlock: string} o null
 */
function parseAIResponse(response) {
    try {
        // Buscar el patrón ARCHIVO: [ruta]
        const fileMatch = response.match(/ARCHIVO:\s*([^\n]+)/i);
        if (!fileMatch) {
            console.log('⚠️  No se encontró el patrón ARCHIVO: en la respuesta');
            return null;
        }
        
        const filePath = fileMatch[1].trim();
        
        // Buscar bloques de código (```cualquier_lenguaje ... ```)
        const codeBlockRegex = /```[\w]*\n([\s\S]*?)\n```/;
        const codeMatch = response.match(codeBlockRegex);
        
        if (!codeMatch) {
            console.log('⚠️  No se encontró bloque de código en la respuesta');
            return null;
        }
        
        const codeBlock = codeMatch[1];
        
        return {
            filePath: filePath,
            codeBlock: codeBlock
        };
        
    } catch (error) {
        console.error('❌ Error al parsear respuesta de IA:', error.message);
        return null;
    }
}

/**
 * Muestra un diff básico entre contenido antiguo y nuevo
 * @param {string} oldContent - Contenido anterior
 * @param {string} newContent - Contenido nuevo
 */
function showDiff(oldContent, newContent) {
    console.log('\n📋 COMPARACIÓN DE CAMBIOS:');
    console.log('=' .repeat(50));
    
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    console.log('🔴 CONTENIDO ANTERIOR:');
    console.log('-'.repeat(30));
    oldLines.slice(0, 10).forEach((line, i) => {
        console.log(`${i + 1}: ${line}`);
    });
    if (oldLines.length > 10) {
        console.log(`... y ${oldLines.length - 10} líneas más`);
    }
    
    console.log('\n🟢 CONTENIDO NUEVO:');
    console.log('-'.repeat(30));
    newLines.slice(0, 10).forEach((line, i) => {
        console.log(`${i + 1}: ${line}`);
    });
    if (newLines.length > 10) {
        console.log(`... y ${newLines.length - 10} líneas más`);
    }
    
    console.log('=' .repeat(50));
}

/**
 * Copia texto al portapapeles (funciona en la mayoría de sistemas)
 * @param {string} text - Texto a copiar
 */
function copyToClipboard(text) {
    return new Promise((resolve, reject) => {
        const proc = spawn('pbcopy', [], { stdio: 'pipe' }); // macOS
        
        proc.on('error', () => {
            // Intentar con xclip en Linux
            const proc2 = spawn('xclip', ['-selection', 'clipboard'], { stdio: 'pipe' });
            
            proc2.on('error', () => {
                console.log('⚠️  No se pudo copiar al portapapeles automáticamente');
                resolve(false);
            });
            
            proc2.on('close', () => {
                console.log('📋 Código copiado al portapapeles');
                resolve(true);
            });
            
            proc2.stdin.write(text);
            proc2.stdin.end();
        });
        
        proc.on('close', () => {
            console.log('📋 Código copiado al portapapeles');
            resolve(true);
        });
        
        proc.stdin.write(text);
        proc.stdin.end();
    });
}

/**
 * Función principal que orquesta toda la lógica
 */
async function main() {
    console.log('🎯 Iniciando herramienta de modificación de código con IA');
    console.log('=' .repeat(60));
    
    let browser, page;
    
    try {
        // Inicializar el trabajador de IA
        const aiWorker = await initAIWorker();
        browser = aiWorker.browser;
        page = aiWorker.page;
        
        // Crear interfaz readline para interacción
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: '\n💬 Tu petición (o "salir" para terminar): '
        });
        
        console.log('\n✨ ¡Listo! Puedes hacer peticiones de modificación de código.');
        console.log('Ejemplo: "Crea un archivo test.js que imprima \'Hola Mundo\'"');
        
        rl.prompt();
        
        rl.on('line', async (input) => {
            const userInput = input.trim();
            
            if (userInput.toLowerCase() === 'salir' || userInput.toLowerCase() === 'exit') {
                console.log('👋 ¡Hasta luego!');
                rl.close();
                return;
            }
            
            if (!userInput) {
                rl.prompt();
                return;
            }
            
            try {
                console.log('\n🔍 Analizando proyecto...');
                
                // Obtener contexto del proyecto
                const projectContext = await getProjectContext();
                
                // Construir mega-prompt para la IA
                const megaPrompt = `
Eres un experto programador senior con amplio conocimiento en múltiples lenguajes y frameworks.

PETICIÓN DEL USUARIO:
${userInput}

CONTEXTO COMPLETO DEL PROYECTO:
${projectContext}

INSTRUCCIONES IMPORTANTES:
1. Analiza cuidadosamente la petición del usuario y el contexto del proyecto
2. Proporciona una solución completa y funcional
3. Si necesitas crear un nuevo archivo, especifica la ruta completa
4. Si necesitas modificar un archivo existente, proporciona el contenido completo actualizado
5. Sigue las mejores prácticas de programación y mantén la consistencia con el estilo existente

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder EXACTAMENTE en este formato:

ARCHIVO: [ruta/del/archivo.extension]
\`\`\`[lenguaje]
[código completo del archivo]
\`\`\`

EXPLICACIÓN:
[breve explicación de los cambios realizados]

Es CRÍTICO que sigas este formato exacto para que el sistema pueda procesar tu respuesta correctamente.
`;
                
                // Consultar a la IA
                const aiResponse = await askAI(page, megaPrompt);
                
                // Parsear la respuesta
                const parsedResponse = parseAIResponse(aiResponse);
                
                if (!parsedResponse) {
                    console.log('❌ No se pudo procesar la respuesta de la IA. Intenta reformular tu petición.');
                    rl.prompt();
                    return;
                }
                
                const { filePath, codeBlock } = parsedResponse;
                
                console.log(`\n📄 Archivo a modificar: ${filePath}`);
                
                // Verificar si el archivo existe para mostrar diff
                let fileExists = false;
                let oldContent = '';
                
                try {
                    oldContent = await fs.readFile(filePath, 'utf8');
                    fileExists = true;
                } catch (error) {
                    console.log('📝 Archivo nuevo (no existe actualmente)');
                }
                
                // Mostrar diff si el archivo existe
                if (fileExists) {
                    showDiff(oldContent, codeBlock);
                } else {
                    console.log('\n📋 CONTENIDO DEL NUEVO ARCHIVO:');
                    console.log('-'.repeat(40));
                    console.log(codeBlock.split('\n').slice(0, 15).join('\n'));
                    if (codeBlock.split('\n').length > 15) {
                        console.log(`... y ${codeBlock.split('\n').length - 15} líneas más`);
                    }
                    console.log('-'.repeat(40));
                }
                
                // Pedir confirmación
                const confirmRl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                confirmRl.question('\n❓ ¿Aplicar cambios? [s]í, [n]o, [c]opiar al portapapeles: ', async (answer) => {
                    const response = answer.toLowerCase().trim();
                    
                    if (response === 's' || response === 'si' || response === 'sí') {
                        try {
                            // Crear directorio si no existe
                            const dir = path.dirname(filePath);
                            await fs.mkdir(dir, { recursive: true });
                            
                            // Escribir el archivo
                            await fs.writeFile(filePath, codeBlock, 'utf8');
                            console.log(`✅ Archivo ${filePath} ${fileExists ? 'modificado' : 'creado'} exitosamente`);
                            
                        } catch (writeError) {
                            console.error('❌ Error al escribir el archivo:', writeError.message);
                        }
                        
                    } else if (response === 'c' || response === 'copiar') {
                        await copyToClipboard(codeBlock);
                        
                    } else {
                        console.log('❌ Cambios cancelados');
                    }
                    
                    confirmRl.close();
                    rl.prompt();
                });
                
            } catch (error) {
                console.error('❌ Error al procesar la petición:', error.message);
                rl.prompt();
            }
        });
        
        // Manejar cierre limpio
        rl.on('close', async () => {
            console.log('\n🔄 Cerrando herramienta...');
            if (browser) {
                await browser.close();
                console.log('✅ Navegador cerrado correctamente');
            }
            process.exit(0);
        });
        
        // Manejar señales del sistema
        process.on('SIGINT', async () => {
            console.log('\n\n🛑 Interrupción detectada...');
            if (browser) {
                await browser.close();
            }
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Error fatal:', error.message);
        if (browser) {
            await browser.close();
        }
        process.exit(1);
    }
}

// Ejecutar la función principal
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Error no manejado:', error);
        process.exit(1);
    });
}

module.exports = {
    initAIWorker,
    getProjectContext,
    askAI,
    parseAIResponse,
    main
};