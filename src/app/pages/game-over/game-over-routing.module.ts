import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { GameOverPage } from './game-over.page';

const routes: Routes = [
  {
    path: '',
    component: GameOverPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class GameOverPageRoutingModule {}
