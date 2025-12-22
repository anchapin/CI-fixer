import { glob } from 'tinyglobby';

async function test() {
    const files = await glob('**/package.json', { 
        ignore: ['node_modules/**']
    });
    console.log('Files found:', files);
}

test();
