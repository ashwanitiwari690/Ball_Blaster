import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular/lazy';
import { SharedModule } from '../../shared/shared.module';

import { GameOverPageRoutingModule } from './game-over-routing.module';

import { GameOverPage } from './game-over.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SharedModule,
    GameOverPageRoutingModule
  ],
  declarations: [GameOverPage]
})
export class GameOverPageModule {}
