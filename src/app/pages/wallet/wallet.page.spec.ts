import { configurePageTestBed } from '../../../testing/page-test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WalletPage } from './wallet.page';

describe('WalletPage', () => {
  let component: WalletPage;
  let fixture: ComponentFixture<WalletPage>;

  beforeEach(() => {
    configurePageTestBed();
    fixture = TestBed.createComponent(WalletPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
