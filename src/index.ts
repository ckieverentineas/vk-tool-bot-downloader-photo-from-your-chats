import { VK } from 'vk-io';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as https from "https";
import * as dotenv from "dotenv";
import { MessagesConversationWithMessage } from 'vk-io/lib/api/schemas/objects';
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

async function* getAllDialogs(): AsyncGenerator<MessagesConversationWithMessage[], void, undefined> {
  let offset = 0;
  let totalCount = 0;
  let dialogs: MessagesConversationWithMessage[] = [];
  do {
    const { items: newDialogs, count } = await vk.api.messages.getConversations({ count: 200, offset });
    dialogs.push(...newDialogs);
    totalCount = count;
    offset += newDialogs.length;
  } while (offset < totalCount);

  for (const dialog of dialogs) {
    /*console.log("🚀 ~ file: index.ts:38 ~ function*getAllDialogs ~ dialog:", dialog)
    fs.appendFile('outputer.txt', `Диалог:\n\n${JSON.stringify(dialog)}\n\n`, (err) => {
      if (err) {
        console.error(err);
        return;
      }
      console.log('Вывод добавлен в файл output.txt');
    });*/
    const dialogDirectory = path.join(DOWNLOAD_DIRECTORY, `${dialog.conversation.peer.type}s`, `${dialog.conversation.peer.id}`);
    await ensureDirectoryExists(dialogDirectory);
    const photosGenerator = getAllPhotosFromDialog(dialog);
    let photos = await photosGenerator.next();
    while (!photos.done) {
      console.log(`Found ${photos.value.length} photos for dialog ${dialog.conversation.peer.id}`);
      photos = await photosGenerator.next();
    }
  }
  yield dialogs;
}

async function* getAllPhotosFromDialog(dialog: MessagesConversationWithMessage): AsyncGenerator<string[], void, undefined> {
  let nextFrom = '';
  while (nextFrom !== undefined) {
    const { items: messages, next_from } = await vk.api.messages.getHistoryAttachments({
      peer_id: dialog.conversation.peer.id,
      media_type: 'photo',
      count: 200,
      start_from: nextFrom,
    });
    nextFrom = next_from;
    
    const photoUrls = messages.map(message => message.attachment.photo.sizes.pop().url);
    if (photoUrls.length > 0) {
      await downloadPhotosWithDelay(photoUrls, delayInMs, dialog.conversation.peer.id, dialog.conversation.peer.type);
      yield photoUrls;
    }
  }
}

async function downloadPhotosWithDelay(urls: string[], delayInMs: number, dialogId: number, dialogType: string): Promise<void> {
  const dialogDirectory = path.join(DOWNLOAD_DIRECTORY, `${dialogType}s`, `${dialogId}`);
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
    console.log(`Found ${dialogs.value.length} dialogs`);
    for (const dialog of dialogs.value) {
      console.log(`Processing dialog with ${dialog.conversation.peer.type} ${dialog.conversation.peer.id}`);
      const photosGenerator = getAllPhotosFromDialog(dialog);
      let photos = await photosGenerator.next();
      while (!photos.done) {
        console.log(`Found ${photos.value.length} photos`);
        if (photos.value.length > 0) {
          await downloadPhotosWithDelay(photos.value, delayInMs, dialog.conversation.peer.id, dialog.conversation.peer.type);
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