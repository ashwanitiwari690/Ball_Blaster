import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CannonDetailsPage } from './cannon-details.page';

describe('CannonDetailsPage', () => {
  let component: CannonDetailsPage;
  let fixture: ComponentFixture<CannonDetailsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CannonDetailsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
