import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular/lazy';
import { SharedModule } from '../../shared/shared.module';

import { RedeemPageRoutingModule } from './redeem-routing.module';

import { RedeemPage } from './redeem.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SharedModule,
    RedeemPageRoutingModule
  ],
  declarations: [RedeemPage]
})
export class RedeemPageModule {}
