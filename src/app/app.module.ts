import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { WalletRepositoryPort } from './core/ports/wallet-repository.port';
import { LocalWalletRepository } from './core/adapters/local-wallet-repository';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, HttpClientModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Swap this line for an ApiWalletRepository (backed by the Node.js
    // backend from the spec) when it exists — nothing else in the app
    // depends on the concrete class, only on the port.
    { provide: WalletRepositoryPort, useClass: LocalWalletRepository },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
