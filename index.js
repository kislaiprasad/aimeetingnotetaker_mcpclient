import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Helper function to read transcript
function readTranscript(filename) {
  const transcriptPath = path.join(__dirname, 'transcripts', filename);
  
  if (!fs.existsSync(transcriptPath)) {
    console.error(`❌ Error: Transcript file not found: ${transcriptPath}`);
    console.log('\n💡 Available transcripts:');
    const transcriptsDir = path.join(__dirname, 'transcripts');
    if (fs.existsSync(transcriptsDir)) {
      const files = fs.readdirSync(transcriptsDir);
      files.forEach(file => console.log(`   - ${file}`));
    }
    process.exit(1);
  }
  
  return fs.readFileSync(transcriptPath, 'utf-8');
}

// Helper function to save MoM
function saveMoM(filename, content) {
  const outputDir = path.join(__dirname, 'output', 'mom');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`✅ MoM saved to: ${outputPath}`);
}

// Helper function to save Confluence draft
function saveConfluenceDraft(filename, content) {
  const outputDir = path.join(__dirname, 'output', 'confluence-drafts');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`✅ Confluence draft saved to: ${outputPath}`);
}

// Main processing function
async function processTranscript(transcriptFile) {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🤖 Meeting Automation System');
  console.log('═══════════════════════════════════════════════════════\n');
  
  console.log(`📄 Processing transcript: ${transcriptFile}`);
  
  try {
    const transcript = readTranscript(transcriptFile);
    
    console.log(`✅ Transcript loaded successfully`);
    console.log(`   Length: ${transcript.length} characters`);
    console.log(`   Lines: ${transcript.split('\n').length}`);
    
    // Display transcript preview
    console.log('\n📝 Transcript Preview (first 500 chars):');
    console.log('─'.repeat(60));
    console.log(transcript.substring(0, 500) + '...');
    console.log('─'.repeat(60));
    
    console.log('\n🎯 Next Steps:');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('1. ✅ Transcript is ready for processing');
    console.log('2. 🔧 Configure your MCP client (Claude Desktop)');
    console.log('3. 🤖 Use AI to process the transcript\n');
    
    console.log('📋 Instructions for Claude Desktop:');
    console.log('─'.repeat(60));
    console.log('Open Claude Desktop and use this prompt:\n');
    console.log('"""');
    console.log('I have a meeting transcript to process. Please:');
    console.log('');
    console.log('1. Read the transcript from: transcripts/' + transcriptFile);
    console.log('2. Search for any Jira issues mentioned');
    console.log('3. Generate comprehensive Minutes of Meeting');
    console.log('4. Extract action items with assignees');
    console.log('5. Create a Confluence page');
    console.log('');
    console.log('Use the template from prompts/mom-template.md');
    console.log('"""');
    console.log('─'.repeat(60));
    
    console.log('\n📁 Output will be saved to:');
    console.log(`   MoM: ${path.join(__dirname, 'output', 'mom')}`);
    console.log(`   Confluence: ${path.join(__dirname, 'output', 'confluence-drafts')}`);
    
    console.log('\n✨ System ready!\n');
    
    return transcript;
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('Usage: node index.js <transcript-file>');
  console.log('');
  console.log('Examples:');
  console.log('  node index.js sample-transcript.txt');
  console.log('  node index.js my-meeting.txt');
  console.log('');
  console.log('The transcript file should be in the transcripts/ directory');
  process.exit(0);
}

const transcriptFile = args[0];

// Run the processor
processTranscript(transcriptFile).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});