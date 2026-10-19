import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public/data', { recursive: true });
copyFileSync('addresses.json', 'public/data/addresses.json');
