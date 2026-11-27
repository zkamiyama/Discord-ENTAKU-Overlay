import type {AppSnapshot} from '../../contracts/domain.ts';
import type {StudioScene} from '../../studio/manifest.ts';

/** A loaded studio and its camera settings form one visible generation.
 * Membership and speech keep flowing while replacement assets load. Structural
 * settings and the last camera plan change together when the candidate commits.
 */
export class ScenePresentation {
 private input:AppSnapshot|null=null;
 private definition:StudioScene|null=null;
 private current:AppSnapshot|null=null;

 resolve(next:AppSnapshot|null,committed:StudioScene|null):AppSnapshot|null {
  if(next===this.input&&committed===this.definition)return this.current;
  this.input=next;this.definition=committed;
  if(!next||!committed||next.studio===committed)this.current=next;
  else this.current={...next,studio:committed,camera:this.current?.camera??next.camera};
  return this.current;
 }

 clear():void{this.input=null;this.definition=null;this.current=null;}
}
