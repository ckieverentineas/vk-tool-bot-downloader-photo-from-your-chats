import { VK } from 'vk-io';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as https from "https";
import * as dotenv from "dotenv";
dotenv.config();

const DOWNLOAD_DIRECTORY = path.join(__dirname, '..', 'photos');
const delayInMs = 100; // 3 секунд задержки между скачиваниями фотографий
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

async function* getAllDialogs(): AsyncGenerator<number[], void, undefined> {
  let nextFrom = '';
  while (nextFrom !== undefined) {
    const { items: dialogs, next_from } = await vk.api.messages.getConversations({ count: 200, start_from: nextFrom });
    nextFrom = next_from;
    yield dialogs.filter(dialog => dialog.conversation.peer.type === 'user').map(dialog => dialog.conversation.peer.id);
  }
}

async function* getAllPhotosFromDialog(dialogId: number): AsyncGenerator<string[], void, undefined> {
  let nextFrom = '';
  while (nextFrom !== undefined) {
    const { items: messages, next_from } = await vk.api.messages.getHistoryAttachments({
      peer_id: dialogId,
      media_type: 'photo',
      count: 200,
      start_from: nextFrom,
    });
    nextFrom = next_from;
    yield messages.map(message => message.attachment.photo.sizes.pop().url);
  }
}

async function downloadPhoto(url: string, filename: string) {
  const name = filename.split('?')[0];
  const filePath = path.join(DOWNLOAD_DIRECTORY, name);
  if (fs.existsSync(filePath)) {
    console.log(`AlreadyExists ${url}`);
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
  const dialogsGenerator = getAllDialogs();
  let dialogs = await dialogsGenerator.next();
  let count = 0;
  while (!dialogs.done) {
    console.log(`Found ${dialogs.value.length} dialogs with users`);
    for (const dialogId of dialogs.value) {
      console.log(`Processing dialog with user ${dialogId}`);
      const photosGenerator = getAllPhotosFromDialog(dialogId);
      let photos = await photosGenerator.next();
      while (!photos.done) {
        console.log(`Found ${photos.value.length} photos`);
        if (photos.value.length > 0) {
          await downloadPhotosWithDelay(photos.value, delayInMs);
        }
        photos = await photosGenerator.next();
      }
    }
    dialogs = await dialogsGenerator.next();
    count++;
    console.log(`Finished processing ${count} batch(es) of dialogs`);
  }
  console.log('All photos have been downloaded.');
})();
