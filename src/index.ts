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
    const userDialogIds = dialogs.filter(dialog => dialog.conversation.peer.type === 'user').map(dialog => dialog.conversation.peer.id);
    for (const dialogId of userDialogIds) {
      const dialogDirectory = path.join(DOWNLOAD_DIRECTORY, `${dialogId}`);
      await ensureDirectoryExists(dialogDirectory);
      const photosGenerator = getAllPhotosFromDialog(dialogId);
      let photos = await photosGenerator.next();
      while (!photos.done) {
        console.log(`Found ${photos.value.length} photos for dialog ${dialogId}`);
        photos = await photosGenerator.next();
      }
    }
    yield userDialogIds;
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
    
    const photoUrls = messages.map(message => message.attachment.photo.sizes.pop().url);
    if (photoUrls.length > 0) {
      await downloadPhotosWithDelay(photoUrls, delayInMs, dialogId);
      yield photoUrls;
    }
  }
}

async function downloadPhotosWithDelay(urls: string[], delayInMs: number, dialogId: number): Promise<void> {
  const dialogDirectory = path.join(DOWNLOAD_DIRECTORY, `${dialogId}`);
  await ensureDirectoryExists(dialogDirectory);
  for (const url of urls) {
    const filename = path.basename(url);
    const filePath = path.join(dialogDirectory, filename.split('?')[0]);
    if (fs.existsSync(filePath)) {
      console.log(`AlreadyExists ${url}`);
      continue;
    }
    await new Promise<void>((resolve, reject) => {
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
          await downloadPhotosWithDelay(photos.value, delayInMs, dialogId);
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