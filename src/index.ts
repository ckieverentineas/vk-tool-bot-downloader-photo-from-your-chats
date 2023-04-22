import { VK } from 'vk-io';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as https from "https";
import * as dotenv from "dotenv";
dotenv.config();

const DOWNLOAD_DIRECTORY = path.join(__dirname, '..', 'photos');
const delayInMs = 3000; // 3 секунд задержки между скачиваниями фотографий
export const token: string | undefined = process.env.token; //root user
const vk = new VK({
  token: token!
});

const statAsync = promisify(fs.stat);
const mkdirAsync = promisify(fs.mkdir);

async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await statAsync(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await mkdirAsync(dirPath, { recursive: true });
    } else {
      throw err;
    }
  }
}

async function getAllDialogs(): Promise<number[]> {
  const { items: dialogs } = await vk.api.messages.getConversations({ count: 200 });

  return dialogs
    .filter(dialog => dialog.conversation.peer.type === 'user')
    .map(dialog => dialog.conversation.peer.id);
}

async function getAllPhotosFromDialog(dialogId: number): Promise<string[]> {
  const { items: messages } = await vk.api.messages.getHistoryAttachments({
    peer_id: dialogId,
    media_type: 'photo',
    count: 200
  });
  return messages.map(message => message.attachment.photo.sizes.pop().url);
}



async function downloadPhoto(url: string, filename: string) {
  const name = filename.split('?')[0];
  const filePath = path.join(DOWNLOAD_DIRECTORY, name);
  if (fs.existsSync(filePath)) {
    console.log(`AlreadyExists ${filename}`);
    return
  }
  return new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      response.pipe(file);
      response.on("end", () => {
        file.close();
        console.log(`Downloaded ${filename}`);
        resolve();
      });
    }).on("error", (error) => {
      reject(error);
    });
  });
}

async function downloadPhotosWithDelay(urls: string[], delayInMs: number): Promise<void> {
  for (const url of urls) {
    const filename = path.basename(url);
    await downloadPhoto(url, filename);
    await new Promise(resolve => setTimeout(resolve, delayInMs));
  }
}

(async () => {
  await ensureDirectoryExists(DOWNLOAD_DIRECTORY);
  const dialogs = await getAllDialogs();
  console.log(`Found ${dialogs.length} dialogs with users`);

  for (const dialogId of dialogs) {
    console.log(`Processing dialog with user ${dialogId}`);
    const photos = await getAllPhotosFromDialog(dialogId);
    console.log(`Found ${photos.length} photos`);
    if (photos.length > 0) {
      await downloadPhotosWithDelay(photos, delayInMs);
    }
  }

  console.log('All photos have been downloaded.');
})();