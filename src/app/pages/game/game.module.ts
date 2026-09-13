import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular/lazy';
import { SharedModule } from '../../shared/shared.module';

import { GamePageRoutingModule } from './game-routing.module';

import { GamePage } from './game.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SharedModule,
    GamePageRoutingModule
  ],
  declarations: [GamePage]
})
export class GamePageModule {}
