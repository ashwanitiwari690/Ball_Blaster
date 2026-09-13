import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular/lazy';
import { SharedModule } from '../../shared/shared.module';

import { CannonDetailsPageRoutingModule } from './cannon-details-routing.module';

import { CannonDetailsPage } from './cannon-details.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SharedModule,
    CannonDetailsPageRoutingModule
  ],
  declarations: [CannonDetailsPage]
})
export class CannonDetailsPageModule {}
