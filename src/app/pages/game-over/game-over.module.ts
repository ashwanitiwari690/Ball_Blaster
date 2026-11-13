import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { IonicModule } from '@ionic/angular/lazy';
import { SharedModule } from '../../shared/shared.module';

import { GameOverPageRoutingModule } from './game-over-routing.module';

import { GameOverPage } from './game-over.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    SharedModule,
    GameOverPageRoutingModule
  ],
  declarations: [GameOverPage]
})
export class GameOverPageModule {}
