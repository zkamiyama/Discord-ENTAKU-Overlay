import type {Page,Locator} from '@playwright/test';
export async function personAction(page:Page,person:Locator,label:string):Promise<void>{
 await person.getByRole('button',{name:'参加者メニュー',exact:true}).click();
 await page.getByRole('menuitem',{name:label,exact:true}).click();
}
export async function openSession(page:Page):Promise<void>{
 const details=page.getByText('接続とセッション',{exact:true}).locator('..');
 if((await details.getAttribute('open'))===null)await details.locator('summary').click();
}
